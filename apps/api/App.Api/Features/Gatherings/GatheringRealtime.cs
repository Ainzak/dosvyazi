using System.Collections.Concurrent;
using System.Security.Claims;
using System.Text.Json;
using App.Api.Features.Accounts;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace App.Api.Features.Gatherings;
public sealed record GatheringConnection(string Id, Guid User, Guid Session, string Stamp, Guid Community, Action Abort);
public sealed class GatheringConnections
{
    private readonly ConcurrentDictionary<string, GatheringConnection> connections = new();
    private readonly object gate = new();
    public GatheringConnection[] All() => connections.Values.ToArray();
    public void Remove(string id) => connections.TryRemove(id, out _);
    public bool Add(GatheringConnection c)
    {
        lock (gate)
        {
            if (!connections.ContainsKey(c.Id) && (connections.Count >= 500 || connections.Values.Count(x => x.User == c.User) >= 8)) return false;
            connections[c.Id] = c; return true;
        }
    }
    public static Task<bool> Authorized(AppDbContext db, GatheringConnection c, CancellationToken ct) => db.Sessions.AsNoTracking().AnyAsync(s => s.Id == c.Session && s.UserId == c.User && s.RevokedAt == null && s.ExpiresAt > DateTimeOffset.UtcNow && s.User.SecurityStamp == c.Stamp &&
        db.Memberships.Any(m => m.CommunityId == c.Community && m.UserId == c.User && m.Status == "Active"), ct);
}
[Authorize]
public sealed class GatheringsHub(AppDbContext db, GatheringService gatherings, GatheringConnections connections, IOptions<IdentityOptions> identity) : Hub
{
    public async Task Subscribe(Guid community)
    {
        var now = DateTimeOffset.UtcNow;
        (DateTimeOffset Start, int Count) attempts = Context.Items.TryGetValue("subscriptions", out var stored) ? ((DateTimeOffset Start, int Count))stored! : (now, 0);
        if (now - attempts.Start >= TimeSpan.FromMinutes(1)) attempts = (now, 0);
        if (attempts.Count >= 12) throw new HubException("Too many subscription attempts. Try again in a minute.");
        Context.Items["subscriptions"] = (attempts.Start, attempts.Count + 1);
        var user = Context.User!;
        var c = new GatheringConnection(Context.ConnectionId, Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!), Guid.Parse(user.FindFirstValue(SessionCookieEvents.SessionClaim)!), user.FindFirstValue(identity.Value.ClaimsIdentity.SecurityStampClaimType) ?? "", community, Context.Abort);
        await using var tx = await db.Database.BeginTransactionAsync(Context.ConnectionAborted);
        try
        {
            await gatherings.LockCommunity(community, c.User, Context.ConnectionAborted);
            if (!await GatheringConnections.Authorized(db, c, Context.ConnectionAborted) || !connections.Add(c)) throw new HubException("Gatherings are unavailable.");
            await tx.CommitAsync(Context.ConnectionAborted);
        }
        catch (App.Api.Features.Communities.CommunityFailure) { throw new HubException("Gatherings are unavailable."); }
    }
    public override Task OnDisconnectedAsync(Exception? exception) { connections.Remove(Context.ConnectionId); return base.OnDisconnectedAsync(exception); }
}
public sealed class GatheringPublisher(AppDbContext db, GatheringConnections connections, IHubContext<GatheringsHub> hub)
{
    public async Task Publish(Guid id, CancellationToken ct)
    {
        var community = await db.GatheringEvents.Where(e => e.Id == id && e.PublishedAt == null).Select(e => (Guid?)e.CommunityId).SingleOrDefaultAsync(ct); if (community is null) return;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(ct);
        var e = await db.GatheringEvents.SingleAsync(e => e.Id == id, ct); if (e.PublishedAt is not null) return;
        var g = await db.Gatherings.SingleAsync(g => g.Id == e.GatheringId, ct);
        var removed = JsonSerializer.Deserialize<Guid[]>(e.RemovedUsersJson) ?? [];
        foreach (var c in connections.All().Where(c => c.Community == community))
        {
            if (!await GatheringConnections.Authorized(db, c, ct)) { connections.Remove(c.Id); c.Abort(); continue; }
            if (await GatheringService.CanView(db, g, c.User, ct) || removed.Contains(c.User))
                // No title, responses or gathering ID: removed invitees can clear caches safely.
                await hub.Clients.Client(c.Id).SendAsync("GatheringsRefresh", new { communityId = community.Value.ToString() }, ct);
        }
        e.PublishedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task Reconcile(CancellationToken ct)
    {
        foreach (var c in connections.All())
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await db.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {c.Community} FOR UPDATE").AnyAsync(ct);
            if (!await GatheringConnections.Authorized(db, c, ct)) { connections.Remove(c.Id); c.Abort(); }
            await tx.CommitAsync(ct);
        }
    }
}
public sealed class GatheringWorker(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<GatheringWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!configuration.GetValue("Gatherings:WorkerEnabled", true)) return;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var publisher = scope.ServiceProvider.GetRequiredService<GatheringPublisher>();
                foreach (var id in await db.GatheringEvents.AsNoTracking().Where(e => e.PublishedAt == null).OrderBy(e => e.Id).Select(e => e.Id).Take(100).ToArrayAsync(ct)) { db.ChangeTracker.Clear(); await publisher.Publish(id, ct); }
                await publisher.Reconcile(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch { logger.LogWarning("Gatherings delivery is interrupted; durable hints will be retried."); }
            try { await Task.Delay(1000, ct); } catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
        }
    }
}
