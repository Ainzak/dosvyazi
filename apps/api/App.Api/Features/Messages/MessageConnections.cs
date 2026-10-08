using System.Collections.Concurrent;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

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

    public static Task<bool> AuthorizedAsync(AppDbContext database, MessageConnection connection, CancellationToken ct) => database.Sessions.AsNoTracking()
        .AnyAsync(session => session.Id == connection.SessionId && session.UserId == connection.UserId && session.RevokedAt == null &&
            session.ExpiresAt > DateTimeOffset.UtcNow && session.User.SecurityStamp == connection.Stamp &&
            database.Memberships.Any(member => member.UserId == connection.UserId && member.CommunityId == connection.CommunityId && member.Status == "Active") &&
            database.TextChannels.Any(channel => channel.Id == connection.ChannelId && channel.CommunityId == connection.CommunityId), ct);
}
