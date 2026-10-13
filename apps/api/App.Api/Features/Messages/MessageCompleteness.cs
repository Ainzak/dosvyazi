using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using App.Api.Features.Communities;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Messages;
public sealed partial class MessageService
{
    public static readonly string[] StandardEmoji = ["👍", "❤️", "😂", "🎉", "😮", "😢"];
    public async Task<MessageDto> ReactAsync(Guid community, Guid channel, Guid user, Guid id, ReactionRequest request, CancellationToken ct)
    {
        if (request.ClientRequestId == Guid.Empty) throw new CommunityFailure(422, "Use a reaction request ID.");
        if (request.Emoji.StartsWith("custom:", StringComparison.Ordinal) && (!Guid.TryParse(request.Emoji[7..], out var canonical) || request.Emoji != "custom:" + canonical.ToString()))
            throw new CommunityFailure(422, "Choose an available reaction.");
        await using var tx = await database.Database.BeginTransactionAsync(ct);
        var resource = await LockAuthorizedAsync(community, channel, user, ct);
        var access = await ChannelAccess.ResolveAsync(database, community, resource, user, ct);
        if (!access.Send) throw new CommunityFailure(403, "You cannot react in this channel.");
        var message = await database.Messages.Include(m => m.Author).Include(m => m.Attachment).Include(m => m.Reactions).SingleOrDefaultAsync(m => m.Id == id && m.ChannelId == channel && !m.Deleted, ct) ?? throw new CommunityFailure(404, "Message is unavailable.");
        var hash = Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { reaction = true, id, request.Emoji, request.Active })));
        var prior = await database.MessageCommands.SingleOrDefaultAsync(c => c.ChannelId == channel && c.ActorId == user && c.ClientRequestId == request.ClientRequestId, ct);
        if (prior is not null)
        {
            if (prior.Hash != hash) throw new CommunityFailure(409, "This request ID was used with a different message change.");
            await tx.CommitAsync(ct); return DtoFor(message, user, access);
        }
        var existing = message.Reactions.SingleOrDefault(r => r.UserId == user && r.Emoji == request.Emoji);
        var custom = request.Emoji.StartsWith("custom:", StringComparison.Ordinal) && Guid.TryParse(request.Emoji[7..], out var emojiId) && await database.CommunityEmojis.AnyAsync(e => e.Id == emojiId && e.CommunityId == community && !e.Deleted, ct);
        if (!StandardEmoji.Contains(request.Emoji) && !custom && !(existing is not null && !request.Active)) throw new CommunityFailure(422, "Choose an available reaction.");
        if (existing is null && request.Active)
        {
            if (message.Reactions.Count >= 256) throw new CommunityFailure(409, "This message has reached its reaction limit.");
            message.Reactions.Add(new() { UserId = user, Emoji = request.Emoji });
        }
        else if (existing is not null && !request.Active) { database.MessageReactions.Remove(existing); message.Reactions.Remove(existing); }
        if ((existing is null && request.Active) || (existing is not null && !request.Active))
        {
            message.Version++;
            var change = new ChannelEvent { Id = Guid.NewGuid(), ChannelId = channel, Message = message, Sequence = ++resource.LastSequence, Kind = "message.edited", CreatedAt = DateTimeOffset.UtcNow };
            database.ChannelEvents.Add(change); database.OutboxEntries.Add(new() { Id = Guid.NewGuid(), Event = change });
        }
        database.MessageCommands.Add(new() { ChannelId = channel, ActorId = user, ClientRequestId = request.ClientRequestId, MessageId = id, Hash = hash, ResultVersion = message.Version });
        await database.SaveChangesAsync(ct); await tx.CommitAsync(ct); return DtoFor(message, user, access);
    }
    public async Task<SearchPage> SearchAsync(Guid community, Guid channel, Guid user, string query, string? before, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(query) || query.Length > 200 || query.Any(char.IsControl)) throw new CommunityFailure(422, "Use 1–200 characters for search.");
        var boundary = before is null ? (long?)null : Cursor(before);
        await using var tx = await database.Database.BeginTransactionAsync(ct);
        var resource = await LockAuthorizedAsync(community, channel, user, ct);
        var results = await database.Messages.AsNoTracking().Include(m => m.Author).Include(m => m.Attachment).Include(m => m.Reactions)
            .Where(m => m.ChannelId == channel && !m.Deleted && (boundary == null || m.Sequence < boundary) && m.SearchVector.Matches(EF.Functions.PlainToTsQuery("simple", query)))
            .OrderByDescending(m => m.Sequence).Take(26).ToArrayAsync(ct);
        var access = await ChannelAccess.ResolveAsync(database, community, resource, user, ct);
        await tx.CommitAsync(ct); return new(results.Take(25).Select(m => DtoFor(m, user, access)).ToArray(), results.Take(25).LastOrDefault()?.Sequence.ToString(CultureInfo.InvariantCulture), results.Length > 25);
    }
    public async Task<ReadStateDto> ReadAsync(Guid community, Guid channel, Guid user, string? sequence, CancellationToken ct)
    {
        await using var tx = await database.Database.BeginTransactionAsync(ct);
        var resource = await LockAuthorizedAsync(community, channel, user, ct);
        var state = await database.ChannelReadStates.SingleOrDefaultAsync(s => s.ChannelId == channel && s.UserId == user, ct);
        if (sequence is not null)
        {
            var cursor = Cursor(sequence); if (cursor > resource.LastSequence) throw new CommunityFailure(422, "Read position is ahead of this channel.");
            if (state is null) { state = new() { ChannelId = channel, UserId = user }; database.ChannelReadStates.Add(state); }
            state.Sequence = Math.Max(state.Sequence, cursor); await database.SaveChangesAsync(ct);
        }
        var value = state?.Sequence ?? 0;
        var count = await database.Messages.CountAsync(m => m.ChannelId == channel && !m.Deleted && m.AuthorId != user && m.Sequence > value, ct);
        await tx.CommitAsync(ct); return new(value.ToString(CultureInfo.InvariantCulture), count);
    }
}
