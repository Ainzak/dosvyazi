using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using App.Api.Features.Communities;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace App.Api.Features.Voice;

// Only signaling crosses the API. Media still travels directly to the SFU.
public sealed class VoiceAdmission(AppDbContext db, IOptions<VoiceOptions> options)
{
    private static CommunityFailure Denied() => new(401, "Voice admission expired or was revoked.");
    internal JwtSecurityToken Token(string token)
    {
        if (!options.Value.Enabled || !options.Value.AdmissionRequired) throw new CommunityFailure(503, "Protected voice admission is unavailable.");
        if (token.Length is < 1 or > 8192) throw Denied();
        try
        {
            var handler = new JwtSecurityTokenHandler { MapInboundClaims = false, MaximumTokenSizeInBytes = 8192 };
            handler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true, IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.Value.ApiSecret)),
                ValidAlgorithms = [SecurityAlgorithms.HmacSha256], ValidateIssuer = true, ValidIssuer = options.Value.ApiKey,
                ValidateAudience = false, RequireExpirationTime = true, ValidateLifetime = true, ClockSkew = TimeSpan.FromSeconds(5),
                // Tolerate a small SFU not-before clock lead. CheckAsync and the
                // handshake deadline still enforce expiration without tolerance.
            }, out var validated);
            return (JwtSecurityToken)validated;
        }
        catch (Exception e) when (e is SecurityTokenException or ArgumentException) { throw Denied(); }
    }

    private async Task<(VoiceRoomBinding Room, VoiceLease Lease)> CheckAsync(JwtSecurityToken jwt, CancellationToken ct)
    {
        if (!Guid.TryParseExact(jwt.Subject, "N", out var identity)) throw Denied();
        var hint = await db.VoiceLeases.AsNoTracking().SingleOrDefaultAsync(l => l.Id == identity, ct) ?? throw Denied();
        // Match account writers' lock order, including password reset and logout.
        await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {hint.UserId} FOR NO KEY UPDATE").AnyAsync(ct);
        await db.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {hint.CommunityId} FOR UPDATE").AnyAsync(ct);
        var lease = await db.VoiceLeases.SingleAsync(l => l.Id == identity, ct);
        var room = await db.VoiceRooms.SingleAsync(r => r.CommunityId == lease.CommunityId && r.ChannelId == lease.ChannelId, ct);
        var access = await ChannelAccess.VoiceAsync(db, lease.CommunityId, lease.ChannelId, lease.UserId, ct);
        if (jwt.ValidTo <= DateTime.UtcNow || jwt.ValidFrom > DateTime.UtcNow.AddSeconds(5) || !lease.Active || lease.ExpiresAt <= DateTimeOffset.UtcNow || room.Status != "Ready" || !room.AdmissionProtected || room.Generation != lease.Generation ||
            !access.Connect || access.Speak != lease.CanSpeak || access.ShareScreen != lease.CanShareScreen || access.UseCamera != lease.CanUseCamera ||
            !await db.Sessions.AnyAsync(s => s.Id == lease.AuthSessionId && s.UserId == lease.UserId && s.RevokedAt == null && s.ExpiresAt > DateTimeOffset.UtcNow && s.User.SecurityStamp == lease.SecurityStamp, ct)) throw Denied();
        try
        {
            using var video = JsonDocument.Parse(jwt.Claims.Single(c => c.Type == "video").Value);
            var grants = video.RootElement;
            bool Flag(string key) => grants.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.True;
            if (!Flag("roomJoin") || !Flag("canSubscribe") || Flag("canPublish") != lease.CanSpeak ||
                new[] { "roomAdmin", "roomCreate", "roomList", "roomRecord", "ingressAdmin", "agent", "recorder", "hidden", "canPublishData", "canUpdateOwnMetadata" }.Any(Flag) ||
                grants.GetProperty("room").GetString() != new VoiceRoom(room.Id, room.Generation).Name) throw Denied();
            var sources = grants.TryGetProperty("canPublishSources", out var list) ? list.EnumerateArray().Select(v => v.GetString()).ToArray() : [];
            string[] allowed = lease.CanSpeak ? ["microphone", .. lease.CanShareScreen ? new[] { "screen_share", "screen_share_audio" } : [], .. lease.CanUseCamera ? new[] { "camera" } : []] : [];
            if (sources.Length != allowed.Length || !sources.ToHashSet().SetEquals(allowed)) throw Denied();
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or KeyNotFoundException) { throw Denied(); }
        return (room, lease);
    }

    public async Task ValidateAsync(string token, CancellationToken ct)
    {
        var jwt = Token(token);
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await CheckAsync(jwt, ct);
        await tx.CommitAsync(ct);
    }

    public async Task<ClientWebSocket> ConnectAsync(string token, string path, string query, CancellationToken ct)
    {
        var jwt = Token(token);
        var operation = Guid.NewGuid();
        Guid channel = default;
        // Persist an in-flight marker before touching the external SFU. A process
        // crash or ambiguous handshake cannot leave an unaccounted delayed join.
        using var admissionTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var remaining = jwt.ValidTo - DateTime.UtcNow;
        if (remaining <= TimeSpan.Zero) throw Denied();
        admissionTimeout.CancelAfter(remaining < TimeSpan.FromSeconds(8) ? remaining : TimeSpan.FromSeconds(8));
        var bounded = admissionTimeout.Token;
        while (true)
        {
            db.ChangeTracker.Clear();
            await using var prepare = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, bounded);
            var (room, _) = await CheckAsync(jwt, bounded);
            if (room.AdmissionAttempt is not null)
            {
                if (room.AdmissionDeadline is null || room.AdmissionDeadline <= DateTimeOffset.UtcNow)
                {
                    VoiceTransitions.Request(room);
                    await db.SaveChangesAsync(bounded); await prepare.CommitAsync(bounded);
                    throw new CommunityFailure(409, "Voice admission is recovering.");
                }
                await prepare.RollbackAsync(bounded);
                await Task.Delay(50, bounded);
                continue;
            }
            channel = room.ChannelId;
            room.AdmissionAttempt = operation; room.AdmissionDeadline = DateTimeOffset.UtcNow.AddSeconds(10);
            await db.SaveChangesAsync(bounded); await prepare.CommitAsync(bounded);
            break;
        }
        var upstream = new ClientWebSocket();
        try
        {
            db.ChangeTracker.Clear();
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, bounded);
            var (room, _) = await CheckAsync(jwt, bounded);
            if (room.AdmissionAttempt != operation) throw Denied();
            var control = new Uri(options.Value.ControlUrl);
            var address = new UriBuilder(control) { Scheme = control.Scheme == "https" ? "wss" : "ws", Path = path, Query = query.TrimStart('?') };
            await upstream.ConnectAsync(address.Uri, bounded);
            // Pinned LiveKit v1.13.9 starts/registers the session before upgrading
            // HTTP. Hold the writer lock through that acknowledgment; a plain
            // forward_auth check would leave a join-versus-revocation race.
            room.AdmissionAttempt = null; room.AdmissionDeadline = null;
            await db.SaveChangesAsync(bounded); await tx.CommitAsync(bounded);
            return upstream;
        }
        catch
        {
            upstream.Abort(); upstream.Dispose();
            // Do not use the disconnected browser's cancellation for durable recovery.
            using var recovery = new CancellationTokenSource(TimeSpan.FromSeconds(4));
            try
            {
                db.ChangeTracker.Clear();
                await using var tx = await db.Database.BeginTransactionAsync(recovery.Token);
                var hint = await db.VoiceRooms.AsNoTracking().SingleAsync(r => r.ChannelId == channel, recovery.Token);
                await db.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {hint.CommunityId} FOR UPDATE").AnyAsync(recovery.Token);
                var room = await db.VoiceRooms.SingleAsync(r => r.ChannelId == channel, recovery.Token);
                if (room.AdmissionAttempt == operation) VoiceTransitions.Request(room);
                await db.SaveChangesAsync(recovery.Token); await tx.CommitAsync(recovery.Token);
            }
            catch (Exception e) when (e is OperationCanceledException or Npgsql.NpgsqlException or DbUpdateException) { /* Durable deadline remains for worker recovery. */ }
            throw;
        }
    }
}
