using System.Data;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using App.Api.Features.Communities;

namespace App.Api.Features.Voice;

public sealed class VoiceReconciler(AppDbContext database, IVoiceGateway gateway, Microsoft.Extensions.Options.IOptions<VoiceOptions> options)
{
    // A quiescent room has nobody who could still enter without a new Join.
    // Join, leave, revocation, admission and SFU webhooks reset NextCheckAt to
    // now, so this interval is only a safety net, not a revocation deadline.
    public static readonly TimeSpan IdleRecheck = TimeSpan.FromMinutes(5);
    // Matches the admission JWT clock skew; a grant is unusable after this.
    public static readonly TimeSpan GrantSkew = TimeSpan.FromSeconds(5);

    public async Task ReconcileAsync(Guid channel, CancellationToken ct)
    {
        var community = await database.VoiceRooms.AsNoTracking().Where(item => item.ChannelId == channel).Select(item => item.CommunityId).SingleOrDefaultAsync(ct);
        if (community == Guid.Empty) return;
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        if (!await database.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(ct)) return;
        var room = await database.VoiceRooms.SingleOrDefaultAsync(item => item.CommunityId == community && item.ChannelId == channel, ct);
        if (room is null) return;
        if (options.Value.AdmissionRequired && !room.AdmissionProtected) VoiceTransitions.Request(room);
        if (room.AdmissionAttempt is not null)
        {
            if (room.AdmissionDeadline is null || room.AdmissionDeadline <= DateTimeOffset.UtcNow) VoiceTransitions.Request(room);
            else if (room.Status == "Ready") { room.NextCheckAt = DateTimeOffset.UtcNow.AddMilliseconds(500); await database.SaveChangesAsync(ct); await transaction.CommitAsync(ct); return; }
        }
        var leases = await database.VoiceLeases.Where(item => item.CommunityId == community && item.ChannelId == channel && item.Active).ToArrayAsync(ct);
        foreach (var lease in leases)
        {
            var access = await ChannelAccess.VoiceAsync(database, community, channel, lease.UserId, ct);
            if (lease.Generation != room.Generation ||
                !access.Connect || lease.CanSpeak != access.Speak || lease.CanShareScreen != access.ShareScreen || lease.CanUseCamera != access.UseCamera ||
                !await database.Sessions.AnyAsync(item => item.Id == lease.AuthSessionId && item.UserId == lease.UserId && item.RevokedAt == null &&
                    item.ExpiresAt > DateTimeOffset.UtcNow && item.User.SecurityStamp == lease.SecurityStamp, ct) ||
                !await database.Memberships.AnyAsync(item => item.CommunityId == community && item.UserId == lease.UserId && item.Status == "Active", ct))
            { lease.Active = false; if (!options.Value.AdmissionRequired || !room.AdmissionProtected || room.AdmissionAttempt is not null) VoiceTransitions.Request(room); else VoiceTransitions.ScheduleRemoval(room); }
            // A lost heartbeat (for example a closed tab) ends this lease, not
            // the authorized peers' room. Access/session revocation above still
            // uses protected removal or durable generation separation.
            else if (lease.ExpiresAt <= DateTimeOffset.UtcNow) lease.Active = false;
        }
        // Persist freeze before any external operation. A process crash or control
        // failure must not roll back the only record of required revocation.
        await database.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        database.ChangeTracker.Clear();

        await using var controlTransaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await database.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(ct);
        room = await database.VoiceRooms.SingleAsync(item => item.CommunityId == community && item.ChannelId == channel, ct);
        var observedEmpty = false;
        var retiredLeft = true;
        try
        {
            if (room.Status == "Ready")
            {
                var actual = await gateway.ParticipantsAsync(new VoiceRoom(room.Id, room.Generation), ct);
                observedEmpty = actual.Count == 0;
                var allowed = await database.VoiceLeases.Where(item => item.CommunityId == community && item.ChannelId == channel && item.Active && item.Generation == room.Generation && item.ExpiresAt > DateTimeOffset.UtcNow)
                    .Select(item => item.Id).ToArrayAsync(ct);
                foreach (var participant in actual.Where(item => !allowed.Any(id => id.ToString("N") == item.Identity)))
                {
                    var departed = Guid.TryParseExact(participant.Identity, "N", out var identity)
                        ? await database.VoiceLeases.SingleOrDefaultAsync(item => item.Id == identity && item.CommunityId == community && item.ChannelId == channel &&
                            item.Generation == room.Generation && !item.Active, ct) : null;
                    if (departed is not null && ((options.Value.AdmissionRequired && room.AdmissionProtected) || (!departed.DisconnectedByModerator && await StillAuthorizedAsync(departed, ct))))
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
            if (VoiceTransitions.RemovalPending(room)) room.CompletedAt = DateTimeOffset.UtcNow;
            if (room.Status == "Pending")
            {
                var old = new VoiceRoom(room.Id, room.Generation);
                await gateway.DeleteRoomAsync(old, ct);
                var next = checked(room.Generation + 1);
                await gateway.CreateRoomAsync(new VoiceRoom(room.Id, next), ct);
                database.RetiredVoiceRooms.Add(new RetiredVoiceRoom { RoomId = room.Id, CommunityId = community,
                    Generation = room.Generation, LastCleanupAt = DateTimeOffset.UtcNow });
                foreach (var lease in await database.VoiceLeases.Where(item => item.CommunityId == community && item.ChannelId == channel && item.Active).ToArrayAsync(ct)) lease.Active = false;
                room.Generation = next;
                room.AdmissionProtected = options.Value.AdmissionRequired; room.AdmissionAttempt = null; room.AdmissionDeadline = null;
                room.Status = "Ready";
                room.CompletedAt = DateTimeOffset.UtcNow;
            }
            // A stale grant can recreate its retired room. Keep a durable inventory
            // and periodically delete those rooms; never move current peers there.
            // Once every grant of that generation has expired, a confirmed delete
            // is final: nobody can recreate the room, so the record is dropped.
            var retiredRooms = database.RetiredVoiceRooms.Where(item => item.CommunityId == community && item.RoomId == room.Id);
            var retiredCount = await retiredRooms.CountAsync(ct);
            foreach (var retired in await retiredRooms.OrderBy(item => item.LastCleanupAt).Take(4).ToArrayAsync(ct))
            {
                var final = await GrantsExpiredAsync(community, channel, retired.Generation, ct);
                await gateway.DeleteRoomAsync(new VoiceRoom(retired.RoomId, retired.Generation), ct);
                if (final) { database.RetiredVoiceRooms.Remove(retired); retiredCount--; }
                else retired.LastCleanupAt = DateTimeOffset.UtcNow;
            }
            retiredLeft = retiredCount > 0;
            room.ControlUnavailable = false;
        }
        catch (VoiceGatewayException)
        {
            room.ControlUnavailable = true;
            // A targeted removal with an uncertain result escalates durably.
            if (options.Value.AdmissionRequired && room.AdmissionProtected && VoiceTransitions.RemovalPending(room)) VoiceTransitions.Request(room);
        }
        // Failure before advancement leaves Pending retryable. A later retired-room
        // cleanup failure does not undo confirmed current-generation separation.
        var quiescent = !room.ControlUnavailable && observedEmpty && !retiredLeft && room.Status == "Ready" &&
            !VoiceTransitions.RemovalPending(room) && room.AdmissionAttempt is null && (!options.Value.AdmissionRequired || room.AdmissionProtected) &&
            !await database.VoiceLeases.AnyAsync(item => item.CommunityId == community && item.ChannelId == channel && item.Active, ct) &&
            await GrantsExpiredAsync(community, channel, room.Generation, ct);
        room.NextCheckAt = DateTimeOffset.UtcNow + (quiescent ? IdleRecheck : TimeSpan.FromSeconds(room.ControlUnavailable ? 3 : 1));
        await database.SaveChangesAsync(ct);
        await controlTransaction.CommitAsync(ct);
    }

    // Leases and grant receipts are retained, and Join is the only issuer of
    // community voice grants, so this bounds when an old token stops working.
    private async Task<bool> GrantsExpiredAsync(Guid community, Guid channel, long generation, CancellationToken ct)
    {
        var latest = await database.VoiceGrantRequests
            .Where(item => item.Lease.CommunityId == community && item.Lease.ChannelId == channel && item.Lease.Generation == generation)
            .MaxAsync(item => (DateTimeOffset?)item.ExpiresAt, ct);
        return latest is null || latest.Value + GrantSkew <= DateTimeOffset.UtcNow;
    }

    private async Task<bool> StillAuthorizedAsync(VoiceLease lease, CancellationToken ct)
    {
        var access = await ChannelAccess.VoiceAsync(database, lease.CommunityId, lease.ChannelId, lease.UserId, ct);
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
                    .OrderBy(item => item.NextCheckAt).Take(16).Select(item => item.ChannelId).ToArrayAsync(stoppingToken);
                foreach (var community in communities)
                {
                    // One failing room must not postpone the rest of the batch.
                    try
                    {
                        using var operation = scopes.CreateScope();
                        await operation.ServiceProvider.GetRequiredService<VoiceReconciler>().ReconcileAsync(community, stoppingToken);
                    }
                    catch (Exception) when (!stoppingToken.IsCancellationRequested)
                    {
                        logger.LogWarning("Voice reconciliation deferred for one room; storage or control service is unavailable.");
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception) { logger.LogWarning("Voice reconciliation deferred; storage or control service is unavailable."); }
        }
    }
}
