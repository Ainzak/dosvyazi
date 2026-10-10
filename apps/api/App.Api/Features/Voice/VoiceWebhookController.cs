using System.Security.Cryptography;
using System.Text;
using App.Api.Infrastructure.Persistence;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace App.Api.Features.Voice;

[AttributeUsage(AttributeTargets.Method)]
public sealed class VoiceWebhookAttribute : Attribute;

public sealed class VoiceWebhookReceipt
{
    public string Id { get; set; } = "";
    public string BodyHash { get; set; } = "";
    public DateTimeOffset ReceivedAt { get; set; }
}

[ApiController, Route("api/v1/voice/webhook")]
public sealed class VoiceWebhookController(AppDbContext database, IOptions<VoiceOptions> options) : ControllerBase
{
    [HttpPost, AllowAnonymous, VoiceWebhook, RequestSizeLimit(262144)]
    public async Task<IActionResult> Receive(CancellationToken ct)
    {
        if (!options.Value.Enabled) return Problem(statusCode: 503, title: "Voice is not configured.");
        // Verify the exact UTF-8 body before parsing/reserialization. No cookie,
        // CSRF token or claimed event type can replace the SFU signature.
        using var raw = new MemoryStream();
        var buffer = new byte[8192];
        int count;
        while ((count = await Request.Body.ReadAsync(buffer, ct)) > 0)
        {
            if (raw.Length + count > 262144) return StatusCode(413);
            await raw.WriteAsync(buffer.AsMemory(0, count), ct);
        }
        var bytes = raw.ToArray();
        WebhookEvent received;
        try
        {
            var body = new UTF8Encoding(false, true).GetString(bytes);
            received = new WebhookReceiver(options.Value.ApiKey, options.Value.ApiSecret)
                .Receive(body, Request.Headers.Authorization.ToString());
            if (string.IsNullOrEmpty(received.Id) || received.Id.Length > 128) return Unauthorized();
        }
        catch { return Unauthorized(); }
        var hash = Convert.ToHexStringLower(SHA256.HashData(bytes));
        var previous = await database.VoiceWebhookReceipts.AsNoTracking().SingleOrDefaultAsync(item => item.Id == received.Id, ct);
        if (previous is not null) return previous.BodyHash == hash ? Ok() : Conflict();
        await using var transaction = await database.Database.BeginTransactionAsync(ct);
        database.VoiceWebhookReceipts.Add(new VoiceWebhookReceipt { Id = received.Id, BodyHash = hash, ReceivedAt = DateTimeOffset.UtcNow });
        // Events are hints only. In particular an old participant_left event must
        // never clear a newer application lease. RoomService reconciles the truth.
        var name = received.Room?.Name;
        if (name is not null && name.StartsWith("vc_", StringComparison.Ordinal))
        {
            var parts = name.Split('_');
            if (parts.Length == 3 && Guid.TryParseExact(parts[1], "N", out var id))
                await database.VoiceRooms.Where(item => item.Id == id).ExecuteUpdateAsync(setters => setters.SetProperty(item => item.NextCheckAt, DateTimeOffset.UtcNow), ct);
        }
        try { await database.SaveChangesAsync(ct); await transaction.CommitAsync(ct); }
        catch (DbUpdateException error) when (error.InnerException is Npgsql.PostgresException { SqlState: "23505" })
        {
            await transaction.RollbackAsync(ct);
            database.ChangeTracker.Clear();
            var duplicate = await database.VoiceWebhookReceipts.AsNoTracking().SingleAsync(item => item.Id == received.Id, ct);
            return duplicate.BodyHash == hash ? Ok() : Conflict();
        }
        return Ok();
    }
}
