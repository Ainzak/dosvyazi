using System.Data;
using System.Globalization;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Messages;

public sealed class EventPublisher(AppDbContext database, MessageConnections connections, IHubContext<MessagesHub> hub)
{
    public async Task PublishAsync(Guid id, CancellationToken ct)
    {
        var communityId = await database.OutboxEntries.AsNoTracking().Where(item => item.Id == id && item.PublishedAt == null)
            .Select(item => (Guid?)item.Event.Message.Channel.CommunityId).SingleOrDefaultAsync(ct);
        if (communityId is null) return;
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        // Same ordering as membership writers; no publication based on stale groups.
        await database.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {communityId.Value} FOR UPDATE").SingleAsync(ct);
        var entry = await database.OutboxEntries.Include(item => item.Event).SingleAsync(item => item.Id == id, ct);
        if (entry.PublishedAt is not null) return;
        foreach (var connection in connections.All().Where(item => item.CommunityId == communityId && item.ChannelId == entry.Event.ChannelId))
        {
            if (!await MessageConnections.AuthorizedAsync(database, connection, ct))
            {
                connections.Remove(connection.Id);
                connection.Abort();
                continue;
            }
            await hub.Clients.Client(connection.Id).SendAsync("ChannelChanged", new ChannelHint(entry.Event.Id.ToString(), entry.Event.ChannelId.ToString(),
                entry.Event.Sequence.ToString(CultureInfo.InvariantCulture), "message.created", 1), ct);
        }
        entry.PublishedAt = DateTimeOffset.UtcNow;
        await database.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public async Task ReconcileAsync(CancellationToken ct)
    {
        foreach (var connection in connections.All())
        {
            if (await MessageConnections.AuthorizedAsync(database, connection, ct)) continue;
            connections.Remove(connection.Id);
            connection.Abort();
        }
    }
}

public sealed class OutboxWorker(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<OutboxWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!configuration.GetValue("Messages:WorkerEnabled", true) || string.IsNullOrWhiteSpace(configuration.GetConnectionString("Dosvyazi"))) return;
        var failed = false;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(500, stoppingToken);
                using var scope = scopes.CreateScope();
                var database = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var publisher = scope.ServiceProvider.GetRequiredService<EventPublisher>();
                await publisher.ReconcileAsync(stoppingToken);
                var ids = await database.OutboxEntries.AsNoTracking().Where(item => item.PublishedAt == null)
                    .OrderBy(item => item.Event.CreatedAt).ThenBy(item => item.Event.Sequence).Take(32).Select(item => item.Id).ToArrayAsync(stoppingToken);
                foreach (var id in ids) { database.ChangeTracker.Clear(); await publisher.PublishAsync(id, stoppingToken); }
                if (failed) logger.LogInformation("Message publication recovered.");
                failed = false;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception)
            {
                // No credentials, connection IDs, message bodies or exception text in logs.
                if (!failed) logger.LogWarning("Message publication is unavailable; durable entries will be retried.");
                failed = true;
                await Task.Delay(2000, stoppingToken);
            }
        }
    }
}
