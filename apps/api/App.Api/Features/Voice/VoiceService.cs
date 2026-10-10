using System.Data;
using System.Security.Claims;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace App.Api.Features.Voice;

public sealed class VoiceService(AppDbContext database, IVoiceGateway gateway, IOptions<VoiceOptions> options,
    IOptions<IdentityOptions> identityOptions, IDataProtectionProvider protection)
{
    private readonly IDataProtector tokens = protection.CreateProtector("Dosvyazi.VoiceGrants.v1");
    private static CommunityFailure Missing() => new(404, "Community voice is unavailable.");

    private async Task<(Guid User, Guid Session, string Stamp)> SessionAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        if (!options.Value.Enabled) throw new CommunityFailure(503, "Voice is not configured.");
        if (!Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var user) ||
            !Guid.TryParse(principal.FindFirstValue(SessionCookieEvents.SessionClaim), out var session))
            throw new CommunityFailure(401, "Sign in again.");
        var stamp = principal.FindFirstValue(identityOptions.Value.ClaimsIdentity.SecurityStampClaimType) ?? "";
        if (!await database.Sessions.AsNoTracking().AnyAsync(item => item.Id == session && item.UserId == user &&
            item.RevokedAt == null && item.ExpiresAt > DateTimeOffset.UtcNow && item.User.SecurityStamp == stamp, ct))
            throw new CommunityFailure(401, "Sign in again.");
        return (user, session, stamp);
    }

    private async Task<EffectiveChannelAccess> AuthorizeAsync(Guid community, Guid user, CancellationToken ct, bool connect = false)
    {
        if (!await database.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(ct) ||
            !await database.Memberships.AnyAsync(item => item.CommunityId == community && item.UserId == user && item.Status == "Active", ct)) throw Missing();
        var access = await ChannelAccess.VoiceAsync(database, community, user, ct);
        if (!access.View) throw Missing();
        if (connect && !access.Connect) throw new CommunityFailure(403, "ConnectVoice is denied.");
        return access;
    }

    public async Task<VoiceJoinDto> JoinAsync(Guid community, JoinVoiceRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (request.ClientRequestId == Guid.Empty) throw new CommunityFailure(400, "Use a voice request ID.");
        var userId = Guid.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        // One account writer lock serializes joins across different communities/hosts.
        await database.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {userId} FOR UPDATE").AnyAsync(ct);
        var access = await AuthorizeAsync(community, userId, ct, true);
        var session = await SessionAsync(principal, ct);
        var room = await database.VoiceRooms.SingleOrDefaultAsync(item => item.CommunityId == community, ct);
        if (room is null)
        {
            room = new VoiceRoomBinding { Id = Guid.NewGuid(), CommunityId = community };
            database.VoiceRooms.Add(room);
        }
        if (room.Status != "Ready") throw new CommunityFailure(409, "Voice access is updating. Wait for the transition to complete.");
        var existing = await database.VoiceGrantRequests.Include(item => item.Lease)
            .SingleOrDefaultAsync(item => item.UserId == userId && item.ClientRequestId == request.ClientRequestId, ct);
        if (existing is not null)
        {
            if (!existing.Lease.Active || existing.Lease.CommunityId != community || existing.Lease.AuthSessionId != session.Session ||
                existing.Lease.Generation != room.Generation || existing.Lease.CanSpeak != access.Speak || existing.ExpiresAt <= DateTimeOffset.UtcNow || existing.Lease.ExpiresAt <= DateTimeOffset.UtcNow)
                throw new CommunityFailure(409, "This voice request expired or changed. Start a new join.");
            var retry = Dto(existing, room);
            await transaction.CommitAsync(ct);
            return retry;
        }
        var lease = await database.VoiceLeases.SingleOrDefaultAsync(item => item.UserId == userId && item.Active, ct);
        if (lease is not null && (lease.CommunityId != community || lease.AuthSessionId != session.Session || lease.Generation != room.Generation))
            throw new CommunityFailure(409, "Leave your other voice session first.");
        if (lease is not null && lease.ExpiresAt <= DateTimeOffset.UtcNow)
            throw new CommunityFailure(409, "The previous voice session is closing. Try again shortly.");
        if (lease is null)
        {
            if (await database.VoiceLeases.CountAsync(item => item.CommunityId == community && item.Active, ct) >= 16)
                throw new CommunityFailure(409, "This voice room is full.");
            lease = new VoiceLease { Id = Guid.NewGuid(), UserId = userId, CommunityId = community,
                AuthSessionId = session.Session, SecurityStamp = session.Stamp, Generation = room.Generation };
            database.VoiceLeases.Add(lease);
        }
        await gateway.CreateRoomAsync(new VoiceRoom(room.Id, room.Generation), ct);
        lease.CanSpeak = access.Speak;
        var grant = gateway.CreateGrant(new VoiceRoom(room.Id, room.Generation), lease.Id, access.Speak);
        lease.ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(90);
        var command = new VoiceGrantRequest { UserId = userId, ClientRequestId = request.ClientRequestId,
            Lease = lease, ProtectedToken = tokens.Protect(grant.Token), ExpiresAt = grant.ExpiresAt };
        database.VoiceGrantRequests.Add(command);
        await database.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Dto(command, room);
    }

    private VoiceJoinDto Dto(VoiceGrantRequest request, VoiceRoomBinding room) => new(request.Lease.Id.ToString(), request.Lease.Id.ToString("N"),
        room.Generation.ToString(System.Globalization.CultureInfo.InvariantCulture), options.Value.BrowserUrl, tokens.Unprotect(request.ProtectedToken), request.ExpiresAt, request.Lease.CanSpeak);

    public async Task<bool> HeartbeatAsync(Guid community, VoiceLeaseRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var session = await SessionAsync(principal, ct);
        await AuthorizeAsync(community, session.User, ct, true);
        session = await SessionAsync(principal, ct);
        var lease = await database.VoiceLeases.SingleOrDefaultAsync(item => item.Id == request.LeaseId && item.CommunityId == community &&
            item.UserId == session.User && item.AuthSessionId == session.Session && item.Active, ct) ?? throw new CommunityFailure(409, "Voice session ended. Rejoin the room.");
        var room = await database.VoiceRooms.SingleAsync(item => item.CommunityId == community, ct);
        if (room.Status != "Ready" || lease.Generation != room.Generation || lease.ExpiresAt <= DateTimeOffset.UtcNow)
            throw new CommunityFailure(409, "Voice access is updating. Rejoin after the transition.");
        lease.ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(90);
        await database.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return true;
    }

    public async Task<VoiceStateDto> LeaveAsync(Guid community, VoiceLeaseRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var session = await SessionAsync(principal, ct);
        await AuthorizeAsync(community, session.User, ct);
        session = await SessionAsync(principal, ct);
        var lease = await database.VoiceLeases.SingleOrDefaultAsync(item => item.Id == request.LeaseId && item.CommunityId == community &&
            item.UserId == session.User && item.AuthSessionId == session.Session, ct) ?? throw Missing();
        if (lease.Active)
        {
            lease.Active = false;
            VoiceTransitions.Request(await database.VoiceRooms.SingleAsync(item => item.CommunityId == community, ct));
            await database.SaveChangesAsync(ct);
        }
        await transaction.CommitAsync(ct);
        return await StateAsync(community, principal, ct);
    }

    public async Task<VoiceStateDto> StateAsync(Guid community, ClaimsPrincipal principal, CancellationToken ct)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var session = await SessionAsync(principal, ct);
        var access = await AuthorizeAsync(community, session.User, ct);
        session = await SessionAsync(principal, ct);
        var room = await database.VoiceRooms.SingleOrDefaultAsync(item => item.CommunityId == community, ct);
        if (room is null) return new("Ready", "1", null, null, false, null, [], access.Connect, access.Speak, access.Has(ChannelAccess.ModerateVoice), access.VoiceDeniedBy);
        var mine = await database.VoiceLeases.Where(item => item.UserId == session.User && item.AuthSessionId == session.Session &&
            item.CommunityId == community && item.Active && item.Generation == room.Generation && item.ExpiresAt > DateTimeOffset.UtcNow).Select(item => (Guid?)item.Id).SingleOrDefaultAsync(ct);
        var participants = Array.Empty<VoiceMemberDto>();
        var unavailable = room.ControlUnavailable;
        if (room.Status == "Ready")
        {
            try
            {
                var actual = await gateway.ParticipantsAsync(new VoiceRoom(room.Id, room.Generation), ct);
                var leases = await database.VoiceLeases.Where(item => item.CommunityId == community && item.Generation == room.Generation && item.Active && item.ExpiresAt > DateTimeOffset.UtcNow)
                    .Join(database.Users, lease => lease.UserId, user => user.Id, (lease, user) => new { lease.Id, user.DisplayName }).ToArrayAsync(ct);
                participants = actual.Join(leases, member => member.Identity, lease => lease.Id.ToString("N"),
                    (member, lease) => new VoiceMemberDto(member.Identity, lease.DisplayName, member.CanPublish, member.AudioTracks)).ToArray();
            }
            catch (VoiceGatewayException) { unavailable = true; }
        }
        await transaction.CommitAsync(ct);
        return new(room.Status, room.Generation.ToString(System.Globalization.CultureInfo.InvariantCulture), room.OperationId?.ToString(), room.CompletedAt,
            unavailable, mine?.ToString(), participants, access.Connect, access.Speak, access.Has(ChannelAccess.ModerateVoice), access.VoiceDeniedBy);
    }

    public async Task<bool> DisconnectAsync(Guid community, VoiceLeaseRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        await using var tx = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var session = await SessionAsync(principal, ct);
        var access = await AuthorizeAsync(community, session.User, ct);
        if (!access.Has(ChannelAccess.ModerateVoice)) throw new CommunityFailure(403, "ModerateVoice is required.");
        var lease = await database.VoiceLeases.SingleOrDefaultAsync(l => l.Id == request.LeaseId && l.CommunityId == community, ct) ?? throw Missing();
        var actor = await ChannelAccess.BaseAsync(database, community, session.User, ct);
        var target = await ChannelAccess.BaseAsync(database, community, lease.UserId, ct);
        if (lease.UserId != session.User && target.Rank >= actor.Rank) throw new CommunityFailure(403, "You cannot disconnect an equal/higher-ranked member.");
        if (lease.Active)
        {
            await VoiceTransitions.RevokeMemberAsync(database, community, lease.UserId, ct);
            CommunityAudit.Add(database, community, session.User, "voice.disconnected", lease.UserId);
            await database.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct);
        return true;
    }
}
