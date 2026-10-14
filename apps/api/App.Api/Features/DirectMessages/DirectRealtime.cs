using System.Collections.Concurrent;
using System.Security.Claims;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace App.Api.Features.DirectMessages;

public sealed record DirectConnection(string Id, Guid User, Guid Session, string Stamp, Guid? Conversation, Action Abort);
public sealed class DirectConnections
{
    private readonly ConcurrentDictionary<string, DirectConnection> connections = new();
    private readonly object gate = new();
    public DirectConnection[] All() => connections.Values.ToArray();
    public void Remove(string id) => connections.TryRemove(id, out _);
    public bool Add(DirectConnection connection)
    {
        lock (gate)
        {
            if (!connections.ContainsKey(connection.Id) && (connections.Count >= 500 || connections.Values.Count(c => c.User == connection.User) >= 8)) return false;
            connections[connection.Id] = connection; return true;
        }
    }
    public static async Task<bool> Authorized(AppDbContext db, DirectConnection connection, CancellationToken ct) =>
        await db.Sessions.AsNoTracking().AnyAsync(s => s.Id == connection.Session && s.UserId == connection.User && s.RevokedAt == null && s.ExpiresAt > DateTimeOffset.UtcNow && s.User.SecurityStamp == connection.Stamp, ct) &&
        (connection.Conversation is null || await db.DirectConversations.AnyAsync(c => c.Id == connection.Conversation && (c.LowerUserId == connection.User || c.UpperUserId == connection.User), ct));
}
[Authorize]
public sealed class DirectHub(AppDbContext db, DirectService service, DirectConnections connections, IOptions<IdentityOptions> identity) : Hub
{
    public async Task Subscribe(Guid? conversation)
    {
        var now = DateTimeOffset.UtcNow;
        var attempts = Context.Items.TryGetValue("subscriptions", out var stored) ? ((DateTimeOffset Start, int Count))stored! : (now, 0);
        if (now - attempts.Item1 >= TimeSpan.FromMinutes(1)) attempts = (now, 0);
        if (attempts.Item2 >= 12) throw new HubException("Too many subscription attempts. Try again in a minute.");
        Context.Items["subscriptions"] = (attempts.Item1, attempts.Item2 + 1);
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(Context.ConnectionAborted);
            var user = await service.SessionAsync(Context.User!, Context.ConnectionAborted);
            if (conversation.HasValue) await service.LockAsync(conversation.Value, Context.User!, Context.ConnectionAborted);
            else await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {user} FOR UPDATE").AnyAsync(Context.ConnectionAborted);
            var connection = new DirectConnection(Context.ConnectionId, user, Guid.Parse(Context.User!.FindFirstValue(SessionCookieEvents.SessionClaim)!),
                Context.User!.FindFirstValue(identity.Value.ClaimsIdentity.SecurityStampClaimType) ?? "", conversation, Context.Abort);
            if (!await DirectConnections.Authorized(db, connection, Context.ConnectionAborted) || !connections.Add(connection)) throw new HubException("Conversation is unavailable.");
            await tx.CommitAsync(Context.ConnectionAborted);
        }
        catch (CommunityFailure) { throw new HubException("Conversation is unavailable."); }
    }
    public override Task OnDisconnectedAsync(Exception? exception) { connections.Remove(Context.ConnectionId); return base.OnDisconnectedAsync(exception); }
}
public sealed class DirectPublisher(AppDbContext db, DirectConnections connections, IHubContext<DirectHub> hub)
{
    public async Task PublishAsync(Guid id, CancellationToken ct)
    {
        var conversationId = await db.DirectEvents.Where(e => e.Id == id && e.PublishedAt == null).Select(e => (Guid?)e.ConversationId).SingleOrDefaultAsync(ct); if (conversationId is null) return;
        var pair = await db.DirectConversations.AsNoTracking().SingleAsync(c => c.Id == conversationId, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {pair.LowerUserId} OR \"Id\" = {pair.UpperUserId} ORDER BY \"Id\" FOR UPDATE").ToArrayAsync(ct);
        await db.DirectConversations.FromSqlInterpolated($"SELECT * FROM \"DirectConversations\" WHERE \"Id\" = {pair.Id} FOR UPDATE").AnyAsync(ct);
        var item = await db.DirectEvents.SingleAsync(e => e.Id == id, ct); if (item.PublishedAt is not null) return;
        foreach (var connection in connections.All().Where(c => c.User == pair.LowerUserId || c.User == pair.UpperUserId))
        {
            if (!await DirectConnections.Authorized(db, connection, ct)) { connections.Remove(connection.Id); connection.Abort(); continue; }
            // Hints carry no content or filenames. Every HTTP recovery rechecks participation and session.
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct); deadline.CancelAfter(TimeSpan.FromSeconds(2));
            try { await hub.Clients.Client(connection.Id).SendAsync("DirectChanged", new { conversationId = pair.Id.ToString(), sequence = item.Sequence.ToString(System.Globalization.CultureInfo.InvariantCulture) }, deadline.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                // A stalled transport must release account locks. This client recovers through HTTP on rejoin.
                connections.Remove(connection.Id); connection.Abort();
            }
        }
        item.PublishedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task ReconcileAsync(CancellationToken ct)
    {
        foreach (var connection in connections.All())
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {connection.User} FOR UPDATE").AnyAsync(ct);
            if (!await DirectConnections.Authorized(db, connection, ct)) { connections.Remove(connection.Id); connection.Abort(); }
            await tx.CommitAsync(ct);
        }
    }
}
public sealed class DirectWorker(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<DirectWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!configuration.GetValue("DirectMessages:WorkerEnabled", true) || string.IsNullOrWhiteSpace(configuration.GetConnectionString("Dosvyazi"))) return;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(1000, ct); using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var publisher = scope.ServiceProvider.GetRequiredService<DirectPublisher>();
                await publisher.ReconcileAsync(ct);
                var ids = await db.DirectEvents.AsNoTracking().Where(e => e.PublishedAt == null).OrderBy(e => e.CreatedAt).ThenBy(e => e.Sequence).Take(32).Select(e => e.Id).ToArrayAsync(ct);
                foreach (var id in ids) { db.ChangeTracker.Clear(); await publisher.PublishAsync(id, ct); }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch { logger.LogWarning("Direct message updates are interrupted; durable hints will be retried."); try { await Task.Delay(2000, ct); } catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; } }
        }
    }
}
