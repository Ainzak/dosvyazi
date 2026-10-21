using System.Data;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using App.Api.Features.Communities;

namespace App.Api.Features.Voice;

public sealed class VoiceReconciler(AppDbContext database, IVoiceGateway gateway)
{
    public async Task ReconcileAsync(Guid community, CancellationToken ct)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        if (!await database.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(ct)) return;
        var room = await database.VoiceRooms.SingleOrDefaultAsync(item => item.CommunityId == community, ct);
        if (room is null) return;
        var leases = await database.VoiceLeases.Where(item => item.CommunityId == community && item.Active).ToArrayAsync(ct);
        foreach (var lease in leases)
        {
            var access = await ChannelAccess.VoiceAsync(database, community, lease.UserId, ct);
            if (lease.Generation != room.Generation ||
                !access.Connect || lease.CanSpeak != access.Speak || lease.CanShareScreen != access.ShareScreen || lease.CanUseCamera != access.UseCamera ||
                !await database.Sessions.AnyAsync(item => item.Id == lease.AuthSessionId && item.UserId == lease.UserId && item.RevokedAt == null &&
                    item.ExpiresAt > DateTimeOffset.UtcNow && item.User.SecurityStamp == lease.SecurityStamp, ct) ||
                !await database.Memberships.AnyAsync(item => item.CommunityId == community && item.UserId == lease.UserId && item.Status == "Active", ct))
            { lease.Active = false; VoiceTransitions.Request(room); }
            // A lost heartbeat (for example a closed tab) ends this lease, not
            // the authorized peers' room. Access/session revocation above still
            // requires durable generation separation.
            else if (lease.ExpiresAt <= DateTimeOffset.UtcNow) lease.Active = false;
        }
        // Persist freeze before any external operation. A process crash or control
        // failure must not roll back the only record of required revocation.
        await database.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        database.ChangeTracker.Clear();

        await using var controlTransaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await database.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(ct);
        room = await database.VoiceRooms.SingleAsync(item => item.CommunityId == community, ct);
        try
        {
            if (room.Status == "Ready")
            {
                var actual = await gateway.ParticipantsAsync(new VoiceRoom(room.Id, room.Generation), ct);
                var allowed = await database.VoiceLeases.Where(item => item.CommunityId == community && item.Active && item.Generation == room.Generation && item.ExpiresAt > DateTimeOffset.UtcNow)
                    .Select(item => item.Id).ToArrayAsync(ct);
                foreach (var participant in actual.Where(item => !allowed.Any(id => id.ToString("N") == item.Identity)))
                {
                    var departed = Guid.TryParseExact(participant.Identity, "N", out var identity)
                        ? await database.VoiceLeases.SingleOrDefaultAsync(item => item.Id == identity && item.CommunityId == community &&
                            item.Generation == room.Generation && !item.Active && !item.DisconnectedByModerator, ct) : null;
                    if (departed is not null && await StillAuthorizedAsync(departed, ct))
                    {
                        // A self-hosted SFU can accept an old token again. Remove
                        // the closed identity on every pass without ejecting peers.
                        // If its account/access has since been revoked, fall back
                        // to the durable generation transition below instead.
                        await gateway.RemoveParticipantAsync(new VoiceRoom(room.Id, room.Generation), identity, ct);
                        continue;
                    }
                    VoiceTransitions.Request(room);
                    await database.SaveChangesAsync(ct);
                    await controlTransaction.CommitAsync(ct);
                    // Next pass performs external work after this freeze is durable.
                    return;
                }
            }
            if (room.Status == "Pending")
            {
                var old = new VoiceRoom(room.Id, room.Generation);
                await gateway.DeleteRoomAsync(old, ct);
                var next = checked(room.Generation + 1);
                await gateway.CreateRoomAsync(new VoiceRoom(room.Id, next), ct);
                database.RetiredVoiceRooms.Add(new RetiredVoiceRoom { RoomId = room.Id, CommunityId = community,
                    Generation = room.Generation, LastCleanupAt = DateTimeOffset.UtcNow });
                foreach (var lease in await database.VoiceLeases.Where(item => item.CommunityId == community && item.Active).ToArrayAsync(ct)) lease.Active = false;
                room.Generation = next;
                room.Status = "Ready";
                room.CompletedAt = DateTimeOffset.UtcNow;
            }
            // A stale grant can recreate its retired room. Keep a durable inventory
            // and periodically delete those rooms; never move current peers there.
            foreach (var retired in await database.RetiredVoiceRooms.Where(item => item.CommunityId == community)
                .OrderBy(item => item.LastCleanupAt).Take(4).ToArrayAsync(ct))
            {
                await gateway.DeleteRoomAsync(new VoiceRoom(retired.RoomId, retired.Generation), ct);
                retired.LastCleanupAt = DateTimeOffset.UtcNow;
            }
            room.ControlUnavailable = false;
        }
        catch (VoiceGatewayException) { room.ControlUnavailable = true; }
        // Failure before advancement leaves Pending retryable. A later retired-room
        // cleanup failure does not undo confirmed current-generation separation.
        room.NextCheckAt = DateTimeOffset.UtcNow.AddSeconds(room.ControlUnavailable ? 3 : 1);
        await database.SaveChangesAsync(ct);
        await controlTransaction.CommitAsync(ct);
    }

    private async Task<bool> StillAuthorizedAsync(VoiceLease lease, CancellationToken ct)
    {
        var access = await ChannelAccess.VoiceAsync(database, lease.CommunityId, lease.UserId, ct);
        return access.View && access.Connect && access.Speak == lease.CanSpeak && access.ShareScreen == lease.CanShareScreen && access.UseCamera == lease.CanUseCamera &&
            await database.Memberships.AnyAsync(item => item.CommunityId == lease.CommunityId && item.UserId == lease.UserId && item.Status == "Active", ct) &&
            await database.Sessions.AnyAsync(item => item.Id == lease.AuthSessionId && item.UserId == lease.UserId && item.RevokedAt == null &&
                item.ExpiresAt > DateTimeOffset.UtcNow && item.User.SecurityStamp == lease.SecurityStamp, ct);
    }
}

public sealed class VoiceWorker(IServiceScopeFactory scopes, Microsoft.Extensions.Options.IOptions<VoiceOptions> options,
    ILogger<VoiceWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled || !options.Value.WorkerEnabled) return;
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(500));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopes.CreateScope();
                var database = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var communities = await database.VoiceRooms.AsNoTracking().Where(item => item.NextCheckAt <= DateTimeOffset.UtcNow)
                    .OrderBy(item => item.NextCheckAt).Take(16).Select(item => item.CommunityId).ToArrayAsync(stoppingToken);
                foreach (var community in communities)
                {
                    using var operation = scopes.CreateScope();
                    await operation.ServiceProvider.GetRequiredService<VoiceReconciler>().ReconcileAsync(community, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception) { logger.LogWarning("Voice reconciliation deferred; storage or control service is unavailable."); }
        }
    }
}
