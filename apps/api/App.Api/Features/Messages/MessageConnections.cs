using System.Collections.Concurrent;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using App.Api.Features.Communities;

namespace App.Api.Features.Messages;

public sealed record MessageConnection(string Id, Guid UserId, Guid SessionId, string Stamp, Guid CommunityId, Guid ChannelId, Action Abort);

// Routing only. Every subscription/publication rechecks database authorization.
public sealed class MessageConnections
{
    private readonly ConcurrentDictionary<string, MessageConnection> connections = new();
    private readonly object gate = new();
    public MessageConnection[] All() => connections.Values.ToArray();
    public void Remove(string id) => connections.TryRemove(id, out _);
    public bool Add(MessageConnection connection)
    {
        lock (gate)
        {
            if (!connections.ContainsKey(connection.Id) && (connections.Count >= 500 || connections.Values.Count(item => item.UserId == connection.UserId) >= 8)) return false;
            connections[connection.Id] = connection;
            return true;
        }
    }

    public static async Task<bool> AuthorizedAsync(AppDbContext database, MessageConnection connection, CancellationToken ct)
    {
        if (!await database.Sessions.AsNoTracking().AnyAsync(session => session.Id == connection.SessionId && session.UserId == connection.UserId && session.RevokedAt == null &&
            session.ExpiresAt > DateTimeOffset.UtcNow && session.User.SecurityStamp == connection.Stamp, ct)) return false;
        var channel = await database.TextChannels.AsNoTracking().SingleOrDefaultAsync(c => c.Id == connection.ChannelId && c.CommunityId == connection.CommunityId, ct);
        return channel is not null && (await ChannelAccess.ResolveAsync(database, connection.CommunityId, channel, connection.UserId, ct)).View;
    }
}
