using System.Security.Claims;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.Voice;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace App.Api.Features.DirectMessages;

public sealed class DirectCallService(AppDbContext db, DirectService direct, IVoiceGateway gateway, IOptions<VoiceOptions> options, IOptions<IdentityOptions> identity)
{
    private static CommunityFailure Missing() => new(404, "Call is unavailable.");
    private static Guid Actor(ClaimsPrincipal principal) => Guid.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private static Guid Session(ClaimsPrincipal principal) => Guid.Parse(principal.FindFirstValue(SessionCookieEvents.SessionClaim)!);
    private void Configured() { if (!options.Value.Enabled || !options.Value.AdmissionRequired) throw new CommunityFailure(503, "Protected calling is not configured."); }
    internal async Task<DirectCall> LockAsync(Guid id, CancellationToken ct)
    {
        var hint = await db.Set<DirectCall>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == id, ct) ?? throw Missing();
        await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {hint.CallerId} OR \"Id\" = {hint.RecipientId} ORDER BY \"Id\" FOR NO KEY UPDATE").ToArrayAsync(ct);
        await db.DirectConversations.FromSqlInterpolated($"SELECT * FROM \"DirectConversations\" WHERE \"Id\" = {hint.ConversationId} FOR UPDATE").AnyAsync(ct);
        return await db.Set<DirectCall>().FromSqlInterpolated($"SELECT * FROM \"DirectCalls\" WHERE \"Id\" = {id} FOR UPDATE").SingleAsync(ct);
    }
    private async Task<DirectCall> Authorized(Guid id, ClaimsPrincipal principal, CancellationToken ct)
    {
        var user = Actor(principal);
        if (!await db.Set<DirectCall>().AnyAsync(c => c.Id == id && (c.CallerId == user || c.RecipientId == user), ct)) throw Missing();
        var call = await LockAsync(id, ct); await direct.SessionAsync(principal, ct); return call;
    }
    private async Task<bool> Blocked(DirectCall call, CancellationToken ct) => await db.UserBlocks.AnyAsync(b =>
        (b.UserId == call.CallerId && b.BlockedUserId == call.RecipientId) || (b.UserId == call.RecipientId && b.BlockedUserId == call.CallerId), ct);
    internal static void End(DirectCall call, string reason)
    {
        if (call.Status == "Ended") return;
        call.Status = "Ended"; call.EndReason = reason; call.EndedAt = DateTimeOffset.UtcNow; call.NextCheckAt = DateTimeOffset.UtcNow;
    }
    internal async Task RefreshAsync(DirectCall call, CancellationToken ct)
    {
        if (call.Status == "Ended") return;
        if (await Blocked(call, ct)) { End(call, "Blocked"); return; }
        if (call.Status == "Ringing" && call.RingUntil <= DateTimeOffset.UtcNow) { End(call, "Missed"); return; }
        if (call.AdmissionAttempt != null && (call.AdmissionDeadline == null || call.AdmissionDeadline <= DateTimeOffset.UtcNow)) { End(call, "Interrupted"); return; }
        var members = await db.Set<DirectCallMember>().Where(m => m.CallId == call.Id).ToArrayAsync(ct);
        if (members.Length != (call.Status == "Active" ? 2 : 1)) { End(call, "Interrupted"); return; }
        foreach (var member in members)
            if (member.ExpiresAt <= DateTimeOffset.UtcNow || !await db.Sessions.AnyAsync(s => s.Id == member.SessionId && s.UserId == member.UserId && s.RevokedAt == null && s.ExpiresAt > DateTimeOffset.UtcNow && s.User.SecurityStamp == member.SecurityStamp, ct))
            { End(call, "Disconnected"); return; }
    }
    private async Task<bool> Busy(Guid user, Guid? except, CancellationToken ct)
    {
        // Stale reservations are released by the durable worker, never by silently
        // evicting another still-live media session from a new call request.
        return await db.VoiceLeases.AnyAsync(l => l.UserId == user && l.Active, ct) ||
            await db.Set<DirectCall>().AnyAsync(c => c.Id != except && (c.CallerId == user && c.Status != "Ended" || c.RecipientId == user && c.Status == "Active"), ct);
    }
    private DirectCallMember Member(DirectCall call, ClaimsPrincipal principal) => new() { Id = Guid.NewGuid(), CallId = call.Id, UserId = Actor(principal), SessionId = Session(principal),
        SecurityStamp = principal.FindFirstValue(identity.Value.ClaimsIdentity.SecurityStampClaimType) ?? "", ExpiresAt = call.Status == "Ringing" ? call.RingUntil : DateTimeOffset.UtcNow.AddSeconds(35) };
    private async Task<DirectCallDto> Dto(DirectCall call, ClaimsPrincipal principal, CancellationToken ct)
    {
        var user = Actor(principal); var other = call.CallerId == user ? call.RecipientId : call.CallerId;
        return new(call.Id.ToString(), call.ConversationId.ToString(), call.CallerId.ToString(), await db.Users.Where(u => u.Id == other).Select(u => u.DisplayName).SingleAsync(ct), call.Status, call.RingUntil, call.EndReason,
            call.Status == "Active" && await db.Set<DirectCallMember>().AnyAsync(m => m.CallId == call.Id && m.UserId == user && m.SessionId == Session(principal), ct));
    }
    public async Task<DirectCallDto> StartAsync(Guid conversation, StartCallRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        Configured(); if (request.ClientRequestId == Guid.Empty) throw new CommunityFailure(400, "Use a call request ID.");
        await using var tx = await db.Database.BeginTransactionAsync(ct); var user = Actor(principal);
        var pair = await db.DirectConversations.AsNoTracking().SingleOrDefaultAsync(c => c.Id == conversation && (c.LowerUserId == user || c.UpperUserId == user), ct) ?? throw Missing();
        // Serialize voice/call/session writers without blocking membership's FK
        // KEY SHARE locks. Call setup never changes account keys.
        await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {pair.LowerUserId} OR \"Id\" = {pair.UpperUserId} ORDER BY \"Id\" FOR NO KEY UPDATE").ToArrayAsync(ct);
        await direct.SessionAsync(principal, ct);
        pair = await db.DirectConversations.FromSqlInterpolated($"SELECT * FROM \"DirectConversations\" WHERE \"Id\" = {conversation} FOR UPDATE").SingleAsync(ct);
        var previous = await db.Set<DirectCall>().SingleOrDefaultAsync(c => c.CallerId == user && c.ClientRequestId == request.ClientRequestId, ct);
        if (previous is not null)
        {
            if (previous.ConversationId != conversation || !await db.Set<DirectCallMember>().AnyAsync(m => m.CallId == previous.Id && m.UserId == user && m.SessionId == Session(principal), ct)) throw new CommunityFailure(409, "This call request belongs to a different session or conversation.");
            await RefreshAsync(previous, ct); await db.SaveChangesAsync(ct); var retry = await Dto(previous, principal, ct); await tx.CommitAsync(ct); return retry;
        }
        if (await direct.BlockedAsync(pair, ct)) throw new CommunityFailure(403, "Contact is unavailable. You can still read earlier messages.");
        var other = pair.LowerUserId == user ? pair.UpperUserId : pair.LowerUserId;
        if (await Busy(user, null, ct) || await Busy(other, null, ct)) throw new CommunityFailure(409, "A participant is already in a call or voice channel.");
        var now = DateTimeOffset.UtcNow; now = now.AddTicks(-(now.Ticks % 10));
        var call = new DirectCall { Id = Guid.NewGuid(), ConversationId = conversation, CallerId = user, RecipientId = other, ClientRequestId = request.ClientRequestId, CreatedAt = now, RingUntil = now.AddSeconds(45), NextCheckAt = now };
        db.Add(call); db.Add(Member(call, principal)); await db.SaveChangesAsync(ct); var result = await Dto(call, principal, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<DirectCallDto[]> CurrentAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        var user = await direct.SessionAsync(principal, ct);
        var ids = await db.Set<DirectCall>().AsNoTracking().Where(c => c.Status != "Ended" && (c.CallerId == user || c.RecipientId == user)).OrderByDescending(c => c.CreatedAt).Take(20).Select(c => c.Id).ToArrayAsync(ct);
        var result = new List<DirectCallDto>();
        foreach (var id in ids) result.Add(await GetAsync(id, principal, ct));
        return result.Where(c => c.Status != "Ended").ToArray();
    }
    public async Task<DirectCallDto> GetAsync(Guid id, ClaimsPrincipal principal, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var call = await Authorized(id, principal, ct);
        await RefreshAsync(call, ct); await db.SaveChangesAsync(ct); var result = await Dto(call, principal, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<DirectCallDto> AcceptAsync(Guid id, ClaimsPrincipal principal, CancellationToken ct)
    {
        Configured(); await using var tx = await db.Database.BeginTransactionAsync(ct); var call = await Authorized(id, principal, ct); await RefreshAsync(call, ct);
        if (call.RecipientId != Actor(principal)) throw new CommunityFailure(403, "Only the recipient can answer this call.");
        if (call.Status == "Ended") { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); throw Missing(); }
        var mine = await db.Set<DirectCallMember>().SingleOrDefaultAsync(m => m.CallId == id && m.UserId == Actor(principal), ct);
        if (mine is not null && mine.SessionId != Session(principal)) throw new CommunityFailure(409, "This call was answered on another device.");
        if (call.Status == "Ringing")
        {
            if (await Busy(call.RecipientId, id, ct) || await Busy(call.CallerId, id, ct)) throw new CommunityFailure(409, "Leave your current voice channel or call before answering.");
            call.Status = "Active"; db.Add(Member(call, principal));
            var caller = await db.Set<DirectCallMember>().SingleAsync(m => m.CallId == id, ct); caller.ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(35);
        }
        await db.SaveChangesAsync(ct); var result = await Dto(call, principal, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<DirectCallDto> EndAsync(Guid id, ClaimsPrincipal principal, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var call = await Authorized(id, principal, ct);
        End(call, call.Status == "Ringing" ? call.CallerId == Actor(principal) ? "Cancelled" : "Declined" : "Hangup");
        await db.SaveChangesAsync(ct); var result = await Dto(call, principal, ct); await tx.CommitAsync(ct); return result;
    }
    internal async Task<DirectCallMember> ActiveMember(DirectCall call, ClaimsPrincipal principal, CancellationToken ct)
    {
        await RefreshAsync(call, ct);
        if (call.Status != "Active") { await db.SaveChangesAsync(ct); throw Missing(); }
        return await db.Set<DirectCallMember>().SingleOrDefaultAsync(m => m.CallId == call.Id && m.UserId == Actor(principal) && m.SessionId == Session(principal), ct) ?? throw Missing();
    }
    public async Task<VoiceJoinDto> JoinAsync(Guid id, JoinVoiceRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        Configured(); if (request.ClientRequestId == Guid.Empty) throw new CommunityFailure(400, "Use a call request ID.");
        await using var tx = await db.Database.BeginTransactionAsync(ct); var call = await Authorized(id, principal, ct); var member = await ActiveMember(call, principal, ct);
        await gateway.CreateRoomAsync(new(call.Id, 1), ct); var grant = gateway.CreateGrant(new(call.Id, 1), member.Id, true, true, true);
        member.ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(35); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(member.Id.ToString(), member.Id.ToString("N"), "1", options.Value.BrowserUrl.TrimEnd('/') + "/direct", grant.Token, grant.ExpiresAt, true, true, true);
    }
    public async Task<bool> HeartbeatAsync(Guid id, VoiceLeaseRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var call = await Authorized(id, principal, ct); var member = await ActiveMember(call, principal, ct);
        if (member.Id != request.LeaseId) throw Missing(); member.ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(35);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return true;
    }
    public async Task<VoiceStateDto> StateAsync(Guid id, ClaimsPrincipal principal, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var call = await Authorized(id, principal, ct); await RefreshAsync(call, ct);
        var members = await db.Set<DirectCallMember>().Where(m => m.CallId == id).Join(db.Users, m => m.UserId, u => u.Id, (m, u) => new { Member = m, u.DisplayName }).ToArrayAsync(ct);
        var active = call.Status == "Active";
        var mine = members.SingleOrDefault(m => m.Member.UserId == Actor(principal) && m.Member.SessionId == Session(principal));
        var result = new VoiceStateDto(active ? "Ready" : "Ended", "1", null, null, false, active ? mine?.Member.Id.ToString() : null,
            active ? members.Select(m => new VoiceMemberDto(m.Member.Id.ToString("N"), m.DisplayName, true, 0)).ToArray() : [], active && mine != null, active, false, null, false, active, active);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return result;
    }
    public async Task ReconcileAsync(Guid id, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var call = await LockAsync(id, ct); await RefreshAsync(call, ct);
        // Commit end intent before external work so a failed delete or process
        // crash never rolls back the revocation that admission must enforce.
        call.NextCheckAt = DateTimeOffset.UtcNow.AddSeconds(1); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        if (call.Status != "Ended" || call.Cleaned) return;
        await gateway.DeleteRoomAsync(new(call.Id, 1), ct);
        await db.Set<DirectCall>().Where(c => c.Id == id && c.Status == "Ended").ExecuteUpdateAsync(c => c.SetProperty(x => x.Cleaned, true), ct);
    }
}
