using System.Data;
using System.Globalization;
using App.Api.Features.Communities;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Messages;

public sealed class MessageService(AppDbContext database)
{
    public static MessageDto Dto(Message message) => new(message.Id.ToString(), message.ChannelId.ToString(), message.AuthorId.ToString(),
        message.Author.DisplayName, message.ClientMessageId.ToString(), message.Sequence.ToString(CultureInfo.InvariantCulture), message.Content, message.CreatedAt);

    public async Task<TextChannel> LockAuthorizedAsync(Guid community, Guid channel, Guid user, CancellationToken ct)
    {
        var exists = await database.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(ct);
        if (!exists || !await database.Memberships.AnyAsync(member => member.CommunityId == community && member.UserId == user && member.Status == "Active", ct))
            throw new CommunityFailure(404, "Community or channel is unavailable.");
        return await database.TextChannels.FromSqlInterpolated($"SELECT * FROM \"TextChannels\" WHERE \"Id\" = {channel} AND \"CommunityId\" = {community} FOR UPDATE")
            .SingleOrDefaultAsync(ct) ?? throw new CommunityFailure(404, "Community or channel is unavailable.");
    }

    private static long Cursor(string? value)
    {
        if (value is null || !long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var result) || result < 0)
            throw new CommunityFailure(400, "Use a nonnegative integer sequence cursor.");
        return result;
    }

    public async Task<MessageDto> SendAsync(Guid community, Guid channel, Guid user, SendMessageRequest request, CancellationToken ct)
    {
        if (request.ClientMessageId == Guid.Empty || string.IsNullOrWhiteSpace(request.Content) || request.Content.Length > 4000 ||
            request.Content.Any(character => char.IsControl(character) && character is not '\n' and not '\r' and not '\t'))
            throw new CommunityFailure(400, "Use a message ID and 1–4000 characters of text.");
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var textChannel = await LockAuthorizedAsync(community, channel, user, ct);
        var message = await database.Messages.Include(item => item.Author).SingleOrDefaultAsync(item => item.ChannelId == channel && item.AuthorId == user && item.ClientMessageId == request.ClientMessageId, ct);
        if (message is null)
        {
            var now = DateTimeOffset.UtcNow;
            now = now.AddTicks(-(now.Ticks % 10));
            message = new Message { Id = Guid.NewGuid(), ChannelId = channel, AuthorId = user, ClientMessageId = request.ClientMessageId,
                Sequence = checked(++textChannel.LastSequence), Content = request.Content, CreatedAt = now,
                Author = await database.Users.SingleAsync(item => item.Id == user, ct) };
            var change = new ChannelEvent { Id = Guid.NewGuid(), ChannelId = channel, Sequence = message.Sequence, Message = message, CreatedAt = now };
            database.Messages.Add(message);
            database.ChannelEvents.Add(change);
            database.OutboxEntries.Add(new OutboxEntry { Id = Guid.NewGuid(), Event = change });
            await database.SaveChangesAsync(ct);
        }
        else if (message.Content != request.Content) throw new CommunityFailure(409, "This message ID was already used with different text.");
        var result = Dto(message);
        await transaction.CommitAsync(ct);
        return result;
    }

    public async Task<MessageSnapshot> HistoryAsync(Guid community, Guid channel, Guid user, string? before, CancellationToken ct)
    {
        var boundary = before is null ? (long?)null : Cursor(before);
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var textChannel = await LockAuthorizedAsync(community, channel, user, ct);
        if (boundary > textChannel.LastSequence) throw new CommunityFailure(400, "The cursor is ahead of this channel.");
        var messages = await database.Messages.AsNoTracking().Include(item => item.Author)
            .Where(item => item.ChannelId == channel && (boundary == null || item.Sequence < boundary))
            .OrderByDescending(item => item.Sequence).Take(51).ToArrayAsync(ct);
        var result = new MessageSnapshot(messages.Take(50).Reverse().Select(Dto).ToArray(), textChannel.LastSequence.ToString(CultureInfo.InvariantCulture), messages.Length > 50);
        await transaction.CommitAsync(ct);
        return result;
    }

    public async Task<CatchUpPage> CatchUpAsync(Guid community, Guid channel, Guid user, string after, CancellationToken ct)
    {
        var cursor = Cursor(after);
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var textChannel = await LockAuthorizedAsync(community, channel, user, ct);
        if (cursor > textChannel.LastSequence) throw new CommunityFailure(400, "The cursor is ahead of this channel.");
        if (cursor > 0 && !await database.ChannelEvents.AnyAsync(item => item.ChannelId == channel && item.Sequence == cursor && item.CreatedAt >= DateTimeOffset.UtcNow.AddDays(-7), ct))
            throw new CommunityFailure(409, "Recovery cursor expired. Reload the channel history.");
        var events = await database.ChannelEvents.AsNoTracking().Include(item => item.Message).ThenInclude(item => item.Author)
            .Where(item => item.ChannelId == channel && item.Sequence > cursor).OrderBy(item => item.Sequence).Take(101).ToArrayAsync(ct);
        var page = events.Take(100).Select(item => new MessageEvent(item.Id.ToString(), channel.ToString(), item.Sequence.ToString(CultureInfo.InvariantCulture), "message.created", 1, Dto(item.Message))).ToArray();
        var result = new CatchUpPage(page, page.LastOrDefault()?.Sequence ?? after, textChannel.LastSequence.ToString(CultureInfo.InvariantCulture), events.Length > 100);
        await transaction.CommitAsync(ct);
        return result;
    }
}
