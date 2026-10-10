using System.Data;
using System.Globalization;
using App.Api.Features.Communities;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace App.Api.Features.Messages;

public sealed class MessageService(AppDbContext database)
{
    public static MessageDto Dto(Message message) => new(message.Id.ToString(), message.ChannelId.ToString(), message.AuthorId.ToString(),
        message.Author.DisplayName, message.ClientMessageId.ToString(), message.Sequence.ToString(CultureInfo.InvariantCulture), message.Deleted ? "" : message.Content, message.CreatedAt,
        message.Version.ToString(CultureInfo.InvariantCulture), message.UpdatedAt, message.Deleted);

    private static MessageDto DtoFor(Message message, Guid user, EffectiveChannelAccess access) => Dto(message);
    private static string ContentHash(string content) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(content)));

    public async Task<TextChannel> LockAuthorizedAsync(Guid community, Guid channel, Guid user, CancellationToken ct)
    {
        var exists = await database.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(ct);
        if (!exists || !await database.Memberships.AnyAsync(member => member.CommunityId == community && member.UserId == user && member.Status == "Active", ct))
            throw new CommunityFailure(404, "Community or channel is unavailable.");
        var textChannel = await database.TextChannels.FromSqlInterpolated($"SELECT * FROM \"TextChannels\" WHERE \"Id\" = {channel} AND \"CommunityId\" = {community} FOR UPDATE")
            .SingleOrDefaultAsync(ct) ?? throw new CommunityFailure(404, "Community or channel is unavailable.");
        if (!(await ChannelAccess.ResolveAsync(database, community, textChannel, user, ct)).View) throw new CommunityFailure(404, "Community or channel is unavailable.");
        return textChannel;
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
        if (!(await ChannelAccess.ResolveAsync(database, community, textChannel, user, ct)).Send) throw new CommunityFailure(403, "You cannot send messages in this channel.");
        var message = await database.Messages.Include(item => item.Author).SingleOrDefaultAsync(item => item.ChannelId == channel && item.AuthorId == user && item.ClientMessageId == request.ClientMessageId, ct);
        if (message is null)
        {
            var now = DateTimeOffset.UtcNow;
            now = now.AddTicks(-(now.Ticks % 10));
            message = new Message { Id = Guid.NewGuid(), ChannelId = channel, AuthorId = user, ClientMessageId = request.ClientMessageId,
                Sequence = checked(++textChannel.LastSequence), Content = request.Content, OriginalContentHash = ContentHash(request.Content), CreatedAt = now,
                Author = await database.Users.SingleAsync(item => item.Id == user, ct) };
            var change = new ChannelEvent { Id = Guid.NewGuid(), ChannelId = channel, Sequence = message.Sequence, Message = message, CreatedAt = now };
            database.Messages.Add(message);
            database.ChannelEvents.Add(change);
            database.OutboxEntries.Add(new OutboxEntry { Id = Guid.NewGuid(), Event = change });
            await database.SaveChangesAsync(ct);
        }
        else if ((message.OriginalContentHash ?? ContentHash(message.Content)) != ContentHash(request.Content)) throw new CommunityFailure(409, "This message ID was already used with different text.");
        var result = DtoFor(message, user, await ChannelAccess.ResolveAsync(database, community, textChannel, user, ct));
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
            .Where(item => item.ChannelId == channel && !item.Deleted && (boundary == null || item.Sequence < boundary))
            .OrderByDescending(item => item.Sequence).Take(51).ToArrayAsync(ct);
        var access = await ChannelAccess.ResolveAsync(database, community, textChannel, user, ct);
        var result = new MessageSnapshot(messages.Take(50).Reverse().Select(m => DtoFor(m, user, access)).ToArray(), textChannel.LastSequence.ToString(CultureInfo.InvariantCulture), messages.Length > 50);
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
        if (cursor == 0 && await database.ChannelEvents.AnyAsync(item => item.ChannelId == channel && item.CreatedAt < DateTimeOffset.UtcNow.AddDays(-7), ct))
            throw new CommunityFailure(409, "Recovery cursor expired. Reload the channel history.");
        var events = await database.ChannelEvents.AsNoTracking().Include(item => item.Message).ThenInclude(item => item.Author)
            .Where(item => item.ChannelId == channel && item.Sequence > cursor).OrderBy(item => item.Sequence).Take(101).ToArrayAsync(ct);
        var access = await ChannelAccess.ResolveAsync(database, community, textChannel, user, ct);
        var page = events.Take(100).Select(item => new MessageEvent(item.Id.ToString(), channel.ToString(), item.Sequence.ToString(CultureInfo.InvariantCulture), item.Message.Deleted ? "message.deleted" : item.Kind, 1,
            item.Message.Deleted ? null : DtoFor(item.Message, user, access), item.MessageId.ToString(), item.Message.Version.ToString(CultureInfo.InvariantCulture))).ToArray();
        var result = new CatchUpPage(page, page.LastOrDefault()?.Sequence ?? after, textChannel.LastSequence.ToString(CultureInfo.InvariantCulture), events.Length > 100);
        await transaction.CommitAsync(ct);
        return result;
    }

    public Task<MessageCommandResult> EditAsync(Guid community, Guid channel, Guid user, Guid id, EditMessageRequest request, CancellationToken ct) => ChangeAsync(community, channel, user, id, request.ClientRequestId, request.ExpectedVersion, request.Content, false, ct);
    public Task<MessageCommandResult> DeleteAsync(Guid community, Guid channel, Guid user, Guid id, DeleteMessageRequest request, CancellationToken ct) => ChangeAsync(community, channel, user, id, request.ClientRequestId, request.ExpectedVersion, "", true, ct);

    private async Task<MessageCommandResult> ChangeAsync(Guid community, Guid channel, Guid user, Guid id, Guid requestId, string expected, string content, bool delete, CancellationToken ct)
    {
        if (requestId == Guid.Empty || !long.TryParse(expected, NumberStyles.None, CultureInfo.InvariantCulture, out var version) || version < 1 ||
            (!delete && (string.IsNullOrWhiteSpace(content) || content.Length > 4000 || content.Any(c => char.IsControl(c) && c is not '\n' and not '\r' and not '\t'))))
            throw new CommunityFailure(400, "Use a request ID, current message version and valid text.");
        var hash = Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { id, version, content, delete })));
        await using var tx = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var textChannel = await LockAuthorizedAsync(community, channel, user, ct);
        var access = await ChannelAccess.ResolveAsync(database, community, textChannel, user, ct);
        var message = await database.Messages.Include(m => m.Author).SingleOrDefaultAsync(m => m.Id == id && m.ChannelId == channel, ct) ?? throw new CommunityFailure(404, "Message is unavailable.");
        if (delete ? !((message.AuthorId == user && access.Send) || access.Has(ChannelAccess.ManageMessages)) : !(message.AuthorId == user && access.Send))
            throw new CommunityFailure(403, "You cannot change this message.");
        var prior = await database.MessageCommands.SingleOrDefaultAsync(c => c.ChannelId == channel && c.ActorId == user && c.ClientRequestId == requestId, ct);
        if (prior is not null)
        {
            if (prior.Hash != hash) throw new CommunityFailure(409, "This request ID was used with a different message change.");
            await tx.CommitAsync(ct);
            return new(id.ToString(), prior.ResultVersion.ToString(CultureInfo.InvariantCulture), DtoFor(message, user, access));
        }
        if (message.Deleted || message.Version != version) throw new CommunityFailure(409, "Message changed. Reload its current version before trying again.");
        message.OriginalContentHash ??= ContentHash(message.Content);
        message.Content = delete ? "" : content;
        message.Deleted = delete;
        message.Version = checked(message.Version + 1);
        message.UpdatedAt = DateTimeOffset.UtcNow;
        message.UpdatedAt = message.UpdatedAt.Value.AddTicks(-(message.UpdatedAt.Value.Ticks % 10));
        var change = new ChannelEvent { Id = Guid.NewGuid(), Message = message, ChannelId = channel, Sequence = checked(++textChannel.LastSequence), Kind = delete ? "message.deleted" : "message.edited", CreatedAt = message.UpdatedAt.Value };
        database.ChannelEvents.Add(change);
        database.OutboxEntries.Add(new OutboxEntry { Id = Guid.NewGuid(), Event = change });
        database.MessageCommands.Add(new MessageCommand { ChannelId = channel, ActorId = user, ClientRequestId = requestId, MessageId = id, Hash = hash, ResultVersion = message.Version });
        CommunityAudit.Add(database, community, user, delete ? "message.deleted" : "message.edited", id);
        await database.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(id.ToString(), message.Version.ToString(CultureInfo.InvariantCulture), DtoFor(message, user, access));
    }
}
