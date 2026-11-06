using System.IdentityModel.Tokens.Jwt;
using System.Net.WebSockets;
using System.Text.Json;
using App.Api.Features.Communities;
using App.Api.Features.Voice;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace App.Api.Features.DirectMessages;

public sealed class DirectCallAdmission(AppDbContext db, DirectCallService service, VoiceAdmission tokens, IOptions<VoiceOptions> options)
{
    private static CommunityFailure Denied() => new(401, "Call admission expired or was revoked.");
    private async Task<DirectCall> Check(JwtSecurityToken jwt, CancellationToken ct)
    {
        if (!Guid.TryParseExact(jwt.Subject, "N", out var subject)) throw Denied();
        var hint = await db.Set<DirectCallMember>().AsNoTracking().SingleOrDefaultAsync(m => m.Id == subject, ct) ?? throw Denied();
        var call = await service.LockAsync(hint.CallId, ct); await service.RefreshAsync(call, ct);
        if (call.Status != "Active" || jwt.ValidTo <= DateTime.UtcNow || jwt.ValidFrom > DateTime.UtcNow.AddSeconds(5)) throw Denied();
        try
        {
            using var video = JsonDocument.Parse(jwt.Claims.Single(c => c.Type == "video").Value); var grant = video.RootElement;
            bool Flag(string key) => grant.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.True;
            if (!Flag("roomJoin") || !Flag("canSubscribe") || !Flag("canPublish") ||
                new[] { "roomAdmin", "roomCreate", "roomList", "roomRecord", "ingressAdmin", "agent", "recorder", "hidden", "canPublishData", "canUpdateOwnMetadata" }.Any(Flag) ||
                grant.GetProperty("room").GetString() != new VoiceRoom(call.Id, 1).Name) throw Denied();
            var sources = grant.GetProperty("canPublishSources").EnumerateArray().Select(v => v.GetString()).ToArray();
            if (sources.Length != 4 || !sources.ToHashSet().SetEquals(["microphone", "camera", "screen_share", "screen_share_audio"])) throw Denied();
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or KeyNotFoundException) { throw Denied(); }
        return call;
    }
    public async Task ValidateAsync(string token, CancellationToken ct)
    {
        var jwt = tokens.Token(token); await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Check(jwt, ct); await tx.CommitAsync(ct);
    }
    public async Task<ClientWebSocket> ConnectAsync(string token, string path, string query, CancellationToken ct)
    {
        var jwt = tokens.Token(token); var operation = Guid.NewGuid(); Guid id = default;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var remaining = jwt.ValidTo - DateTime.UtcNow; if (remaining <= TimeSpan.Zero) throw Denied();
        deadline.CancelAfter(remaining < TimeSpan.FromSeconds(8) ? remaining : TimeSpan.FromSeconds(8)); var bounded = deadline.Token;
        while (true)
        {
            db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(bounded); var call = await Check(jwt, bounded);
            if (call.AdmissionAttempt != null) { await tx.RollbackAsync(bounded); await Task.Delay(50, bounded); continue; }
            id = call.Id; call.AdmissionAttempt = operation; call.AdmissionDeadline = DateTimeOffset.UtcNow.AddSeconds(10);
            await db.SaveChangesAsync(bounded); await tx.CommitAsync(bounded); break;
        }
        var upstream = new ClientWebSocket();
        try
        {
            db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(bounded); var call = await Check(jwt, bounded);
            if (call.AdmissionAttempt != operation) throw Denied();
            var control = new Uri(options.Value.ControlUrl);
            var address = new UriBuilder(control) { Scheme = control.Scheme == "https" ? "wss" : "ws", Path = path, Query = query.TrimStart('?') };
            await upstream.ConnectAsync(address.Uri, bounded);
            call.AdmissionAttempt = null; call.AdmissionDeadline = null; await db.SaveChangesAsync(bounded); await tx.CommitAsync(bounded); return upstream;
        }
        catch
        {
            upstream.Abort(); upstream.Dispose(); using var recovery = new CancellationTokenSource(TimeSpan.FromSeconds(4));
            try
            {
                db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(recovery.Token);
                var call = await service.LockAsync(id, recovery.Token); DirectCallService.End(call, "Interrupted");
                await db.SaveChangesAsync(recovery.Token); await tx.CommitAsync(recovery.Token);
            }
            catch (Exception e) when (e is OperationCanceledException or Npgsql.NpgsqlException or DbUpdateException) { /* The durable deadline remains for worker recovery. */ }
            throw;
        }
    }
}

public sealed class DirectCallWorker(IServiceScopeFactory scopes, IOptions<VoiceOptions> options, ILogger<DirectCallWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled || !options.Value.AdmissionRequired || !options.Value.WorkerEnabled) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var ids = await db.Set<DirectCall>().AsNoTracking().Where(c => !c.Cleaned && c.NextCheckAt <= DateTimeOffset.UtcNow).OrderBy(c => c.NextCheckAt).Take(16).Select(c => c.Id).ToArrayAsync(stoppingToken);
                foreach (var id in ids)
                {
                    try { using var operation = scopes.CreateScope(); await operation.ServiceProvider.GetRequiredService<DirectCallService>().ReconcileAsync(id, stoppingToken); }
                    catch (VoiceGatewayException) { logger.LogWarning("Call media cleanup deferred; control service is unavailable."); }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception) { logger.LogWarning("Call reconciliation deferred; storage or control service is unavailable."); }
        }
    }
}
