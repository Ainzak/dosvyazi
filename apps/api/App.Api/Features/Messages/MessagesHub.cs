using System.Data;
using System.Security.Claims;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Messages;

[Authorize]
public sealed class MessagesHub(AppDbContext database, MessageService messages, MessageConnections connections, IOptions<IdentityOptions> identity) : Hub
{
    // One channel per connection. HTTP owns all mutations, protected by CSRF.
    public async Task Subscribe(Guid communityId, Guid channelId)
    {
        var now = DateTimeOffset.UtcNow;
        var attempts = Context.Items.TryGetValue("subscriptions", out var stored) ? ((DateTimeOffset Start, int Count))stored! : (now, 0);
        if (now - attempts.Item1 >= TimeSpan.FromMinutes(1)) attempts = (now, 0);
        if (attempts.Item2 >= 12) throw new HubException("Too many subscription attempts. Try again in a minute.");
        Context.Items["subscriptions"] = (attempts.Item1, attempts.Item2 + 1);
        var user = Context.User!;
        var connection = new MessageConnection(Context.ConnectionId,
            Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!), Guid.Parse(user.FindFirstValue(SessionCookieEvents.SessionClaim)!),
            user.FindFirstValue(identity.Value.ClaimsIdentity.SecurityStampClaimType) ?? string.Empty, communityId, channelId, Context.Abort);
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, Context.ConnectionAborted);
        try
        {
            await messages.LockAuthorizedAsync(communityId, channelId, connection.UserId, Context.ConnectionAborted);
            if (!await MessageConnections.AuthorizedAsync(database, connection, Context.ConnectionAborted)) throw new HubException("Channel unavailable.");
            if (!connections.Add(connection)) throw new HubException("Too many active channel connections.");
            await transaction.CommitAsync(Context.ConnectionAborted);
        }
        catch (CommunityFailure) { throw new HubException("Channel unavailable."); }
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        connections.Remove(Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}
