using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace App.Api.Features.DirectMessages;

public sealed class DirectService(AppDbContext db, AttachmentStore files, IOptions<IdentityOptions> identity)
{
    private static CommunityFailure Missing() => new(404, "Conversation is unavailable.");
    private static string Hash(object value) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private static string Sequence(long value) => value.ToString(CultureInfo.InvariantCulture);
    private static DateTimeOffset Now() { var now = DateTimeOffset.UtcNow; return now.AddTicks(-(now.Ticks % 10)); }
    private static long Cursor(string value) => long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var number) && number >= 0 ? number : throw new CommunityFailure(400, "Use a nonnegative sequence cursor.");
    private static Guid Actor(ClaimsPrincipal principal) => Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var user) ? user : throw new CommunityFailure(401, "Sign in again.");
    public async Task<Guid> SessionAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        var user = Actor(principal);
        var stamp = principal.FindFirstValue(identity.Value.ClaimsIdentity.SecurityStampClaimType) ?? "";
        if (!Guid.TryParse(principal.FindFirstValue(SessionCookieEvents.SessionClaim), out var session) ||
            !await db.Sessions.AsNoTracking().AnyAsync(s => s.Id == session && s.UserId == user && s.RevokedAt == null && s.ExpiresAt > DateTimeOffset.UtcNow && s.User.SecurityStamp == stamp, ct))
            throw new CommunityFailure(401, "Sign in again.");
        return user;
    }
    private async Task LockUsers(Guid first, Guid second, CancellationToken ct)
    {
        // Same sorted account ordering for starts, blocks, sends and publications; logout also locks its account.
        var users = await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {first} OR \"Id\" = {second} ORDER BY \"Id\" FOR UPDATE").ToArrayAsync(ct);
        if (users.Length != (first == second ? 1 : 2)) throw Missing();
    }
    public async Task<DirectConversation> LockAsync(Guid id, ClaimsPrincipal principal, CancellationToken ct)
    {
        var user = Actor(principal);
        var pair = await db.DirectConversations.AsNoTracking().SingleOrDefaultAsync(c => c.Id == id && (c.LowerUserId == user || c.UpperUserId == user), ct) ?? throw Missing();
        await LockUsers(pair.LowerUserId, pair.UpperUserId, ct); await SessionAsync(principal, ct);
        return await db.DirectConversations.FromSqlInterpolated($"SELECT * FROM \"DirectConversations\" WHERE \"Id\" = {id} FOR UPDATE").SingleAsync(ct);
    }
    public Task<bool> BlockedAsync(DirectConversation conversation, CancellationToken ct) => db.UserBlocks.AnyAsync(b =>
        (b.UserId == conversation.LowerUserId && b.BlockedUserId == conversation.UpperUserId) || (b.UserId == conversation.UpperUserId && b.BlockedUserId == conversation.LowerUserId), ct);
    private async Task RequireContact(DirectConversation conversation, CancellationToken ct)
    {
        if (await BlockedAsync(conversation, ct)) throw new CommunityFailure(403, "Contact is unavailable. You can still read earlier messages.");
    }
    private async Task<DirectConversationDto> Dto(DirectConversation conversation, Guid user, CancellationToken ct)
    {
        var other = conversation.LowerUserId == user ? conversation.UpperUserId : conversation.LowerUserId;
        var read = await db.DirectReadStates.Where(r => r.ConversationId == conversation.Id && r.UserId == user).Select(r => (long?)r.Sequence).SingleOrDefaultAsync(ct) ?? 0;
        var unread = await db.DirectMessages.CountAsync(m => m.ConversationId == conversation.Id && m.AuthorId != user && !m.Deleted && m.Sequence > read, ct);
        return new(conversation.Id.ToString(), other.ToString(), await db.Users.Where(u => u.Id == other).Select(u => u.DisplayName).SingleAsync(ct), Sequence(conversation.Sequence), unread,
            await db.UserBlocks.AnyAsync(b => b.UserId == user && b.BlockedUserId == other, ct), await BlockedAsync(conversation, ct), conversation.UpdatedAt);
    }
    public async Task<DirectConversationDto> StartAsync(StartDirectRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var user = Actor(principal);
        if (request.ClientRequestId == Guid.Empty || request.UserId == Guid.Empty || user == request.UserId) throw new CommunityFailure(400, "Choose another signed-in user's profile and a request ID.");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockUsers(user, request.UserId, ct); await SessionAsync(principal, ct);
        var hash = Hash(new { action = "start", request.UserId });
        var receipt = await db.DirectCommands.SingleOrDefaultAsync(c => c.UserId == user && c.ClientRequestId == request.ClientRequestId, ct);
        if (receipt is not null && receipt.Hash != hash) throw new CommunityFailure(409, "This request ID was used for another conversation change.");
        var lower = string.CompareOrdinal(user.ToString("N"), request.UserId.ToString("N")) < 0 ? user : request.UserId;
        var upper = lower == user ? request.UserId : user;
        var conversation = await db.DirectConversations.SingleOrDefaultAsync(c => c.LowerUserId == lower && c.UpperUserId == upper, ct);
        if (conversation is null)
        {
            conversation = new() { Id = Guid.NewGuid(), LowerUserId = lower, UpperUserId = upper, UpdatedAt = Now() };
            await RequireContact(conversation, ct); db.DirectConversations.Add(conversation);
            db.DirectEvents.Add(new() { Id = Guid.NewGuid(), ConversationId = conversation.Id, Sequence = 0, Kind = "conversation.created", CreatedAt = conversation.UpdatedAt });
        }
        if (receipt is null) db.DirectCommands.Add(new() { UserId = user, ClientRequestId = request.ClientRequestId, ConversationId = conversation.Id, Hash = hash });
        await db.SaveChangesAsync(ct); var result = await Dto(conversation, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<DirectInbox> InboxAsync(ClaimsPrincipal principal, Guid? before, CancellationToken ct)
    {
        var user = await SessionAsync(principal, ct);
        var query = db.DirectConversations.AsNoTracking().Where(c => c.LowerUserId == user || c.UpperUserId == user);
        if (before.HasValue)
        {
            var anchor = await query.SingleOrDefaultAsync(c => c.Id == before.Value, ct) ?? throw Missing();
            query = query.Where(c => c.UpdatedAt < anchor.UpdatedAt || (c.UpdatedAt == anchor.UpdatedAt && c.Id.CompareTo(anchor.Id) < 0));
        }
        var rows = await query.OrderByDescending(c => c.UpdatedAt).ThenByDescending(c => c.Id).Take(51).ToArrayAsync(ct);
        var result = new List<DirectConversationDto>(); foreach (var row in rows.Take(50)) result.Add(await Dto(row, user, ct));
        return new(result.ToArray(), rows.Length > 50 ? result[^1].Id : null, rows.Length > 50);
    }
    public async Task<DirectConversationDto> GetAsync(Guid id, ClaimsPrincipal principal, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var conversation = await LockAsync(id, principal, ct);
        var result = await Dto(conversation, Actor(principal), ct); await tx.CommitAsync(ct); return result;
    }
    public static DirectMessageDto MessageDto(DirectMessage message) => new(message.Id.ToString(), message.ConversationId.ToString(), message.AuthorId.ToString(), message.Author.DisplayName,
        message.ClientMessageId.ToString(), Sequence(message.Sequence), message.Deleted ? "" : message.Content, message.CreatedAt, Sequence(message.Version), message.UpdatedAt, message.Deleted,
        message.Deleted || message.Attachment is null ? null : new(message.Attachment.Id.ToString(), message.Attachment.Name, message.Attachment.Size, message.Attachment.Kind, message.Attachment.ContentType, message.Attachment.DurationMs));
    private void Event(DirectConversation conversation, string kind, Guid? message)
    {
        conversation.Sequence = checked(conversation.Sequence + 1); conversation.UpdatedAt = Now();
        db.DirectEvents.Add(new() { Id = Guid.NewGuid(), ConversationId = conversation.Id, Sequence = conversation.Sequence, MessageId = message, Kind = kind, CreatedAt = conversation.UpdatedAt });
    }
    public async Task<DirectMessageDto> SendAsync(Guid id, SendMessageRequest request, ClaimsPrincipal principal, PreparedAttachment? attachment, CancellationToken ct)
    {
        if (request.ClientMessageId == Guid.Empty || request.Content.Length > 4000 || (string.IsNullOrWhiteSpace(request.Content) && attachment is null) || request.Content.Any(c => char.IsControl(c) && c is not '\r' and not '\n' and not '\t'))
            throw new CommunityFailure(400, "Use a message ID and up to 4000 characters or one attachment.");
        await using var tx = await db.Database.BeginTransactionAsync(ct); var conversation = await LockAsync(id, principal, ct); var user = Actor(principal);
        await RequireContact(conversation, ct);
        var hash = Hash(new { request.Content, attachment?.Name, attachment?.Kind, bytes = attachment?.InputHash ?? attachment?.Hash });
        var message = await db.DirectMessages.Include(m => m.Author).Include(m => m.Attachment).SingleOrDefaultAsync(m => m.ConversationId == id && m.AuthorId == user && m.ClientMessageId == request.ClientMessageId, ct);
        if (message is null)
        {
            if (await db.DirectMessages.CountAsync(m => m.AuthorId == user && m.CreatedAt >= DateTimeOffset.UtcNow.AddMinutes(-1), ct) >= 60)
                throw new CommunityFailure(429, "Too many direct messages. Try again in a minute.");
            Event(conversation, "message.created", null);
            message = new() { Id = Guid.NewGuid(), ConversationId = id, AuthorId = user, Author = await db.Users.SingleAsync(u => u.Id == user, ct), ClientMessageId = request.ClientMessageId,
                Content = request.Content, RequestHash = hash, Sequence = conversation.Sequence, CreatedAt = conversation.UpdatedAt };
            db.DirectEvents.Local.Single(e => e.ConversationId == id && e.Sequence == conversation.Sequence).MessageId = message.Id;
            db.DirectMessages.Add(message);
            if (attachment is not null)
            {
                await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(73421891)", ct);
                if (files.UsedBytes() + attachment.Bytes.Length > files.QuotaBytes) throw new CommunityFailure(409, "Attachment storage is full. Ask the operator to free space.");
                message.Attachment = new() { Id = Guid.NewGuid(), Name = attachment.Name, Hash = attachment.Hash, Size = attachment.Bytes.Length, Kind = attachment.Kind, ContentType = attachment.ContentType, DurationMs = attachment.DurationMs };
                await files.WriteAsync(message.Attachment.Id, attachment.Bytes, ct);
            }
            await db.SaveChangesAsync(ct);
        }
        else if (message.RequestHash != hash) throw new CommunityFailure(409, "This message ID was already used with different content.");
        await tx.CommitAsync(ct); return MessageDto(message);
    }
    public async Task<DirectSnapshot> HistoryAsync(Guid id, ClaimsPrincipal principal, string? before, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var conversation = await LockAsync(id, principal, ct); var cursor = before is null ? (long?)null : Cursor(before);
        var messages = await db.DirectMessages.AsNoTracking().Include(m => m.Author).Include(m => m.Attachment).Where(m => m.ConversationId == id && !m.Deleted && (cursor == null || m.Sequence < cursor)).OrderByDescending(m => m.Sequence).Take(51).ToArrayAsync(ct);
        var result = new DirectSnapshot(messages.Take(50).Reverse().Select(MessageDto).ToArray(), Sequence(conversation.Sequence), messages.Length > 50); await tx.CommitAsync(ct); return result;
    }
    public async Task<DirectCatchUp> EventsAsync(Guid id, ClaimsPrincipal principal, string after, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var conversation = await LockAsync(id, principal, ct); var cursor = Cursor(after);
        if (cursor > conversation.Sequence) throw new CommunityFailure(400, "The cursor is ahead of this conversation.");
        if (cursor > 0 && !await db.DirectEvents.AnyAsync(e => e.ConversationId == id && e.Sequence == cursor && e.CreatedAt >= DateTimeOffset.UtcNow.AddDays(-7), ct)) throw new CommunityFailure(409, "Reload conversation history.");
        var events = await db.DirectEvents.AsNoTracking().Where(e => e.ConversationId == id && e.Sequence > cursor).OrderBy(e => e.Sequence).Take(101).ToArrayAsync(ct);
        var items = new List<DirectEventDto>();
        foreach (var item in events.Take(100))
        {
            var message = item.MessageId is null ? null : await db.DirectMessages.AsNoTracking().Include(m => m.Author).Include(m => m.Attachment).SingleAsync(m => m.Id == item.MessageId, ct);
            items.Add(new(item.Id.ToString(), id.ToString(), Sequence(item.Sequence), item.Kind, message is null ? null : MessageDto(message)));
        }
        var result = new DirectCatchUp(items.ToArray(), Sequence(conversation.Sequence), items.Count == 0 ? after : items[^1].Sequence, events.Length > 100); await tx.CommitAsync(ct); return result;
    }
    public async Task<DirectConversationDto> ReadAsync(Guid id, DirectReadRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var conversation = await LockAsync(id, principal, ct); var user = Actor(principal); var sequence = Cursor(request.Sequence);
        if (sequence > conversation.Sequence) throw new CommunityFailure(400, "The cursor is ahead of this conversation.");
        var state = await db.DirectReadStates.SingleOrDefaultAsync(s => s.ConversationId == id && s.UserId == user, ct);
        if (state is null) db.DirectReadStates.Add(new() { ConversationId = id, UserId = user, Sequence = sequence }); else state.Sequence = Math.Max(state.Sequence, sequence);
        await db.SaveChangesAsync(ct); var result = await Dto(conversation, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<DirectConversationDto> BlockAsync(Guid id, BlockDirectRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (request.ClientRequestId == Guid.Empty) throw new CommunityFailure(400, "Use a request ID.");
        await using var tx = await db.Database.BeginTransactionAsync(ct); var conversation = await LockAsync(id, principal, ct); var user = Actor(principal); var other = conversation.LowerUserId == user ? conversation.UpperUserId : conversation.LowerUserId;
        var hash = Hash(new { action = "block", id, request.Blocked });
        var receipt = await db.DirectCommands.SingleOrDefaultAsync(c => c.UserId == user && c.ClientRequestId == request.ClientRequestId, ct);
        if (receipt is not null && receipt.Hash != hash) throw new CommunityFailure(409, "This request ID was used for another conversation change.");
        if (receipt is null)
        {
            var block = await db.UserBlocks.SingleOrDefaultAsync(b => b.UserId == user && b.BlockedUserId == other, ct);
            if (request.Blocked && block is null) db.UserBlocks.Add(new() { UserId = user, BlockedUserId = other, CreatedAt = Now() });
            else if (!request.Blocked && block is not null) db.UserBlocks.Remove(block);
            db.DirectCommands.Add(new() { UserId = user, ClientRequestId = request.ClientRequestId, ConversationId = id, Hash = hash }); Event(conversation, "contact.changed", null); await db.SaveChangesAsync(ct);
        }
        var result = await Dto(conversation, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<DirectMessageDto> ChangeAsync(Guid id, Guid messageId, Guid requestId, string version, string? content, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (requestId == Guid.Empty || Cursor(version) < 1 || (content is not null && (string.IsNullOrWhiteSpace(content) || content.Length > 4000 || content.Any(c => char.IsControl(c) && c is not '\r' and not '\n' and not '\t')))) throw new CommunityFailure(400, "Use a request ID, version and up to 4000 characters.");
        await using var tx = await db.Database.BeginTransactionAsync(ct); var conversation = await LockAsync(id, principal, ct); var user = Actor(principal);
        var message = await db.DirectMessages.Include(m => m.Author).Include(m => m.Attachment).SingleOrDefaultAsync(m => m.Id == messageId && m.ConversationId == id, ct) ?? throw Missing();
        if (message.AuthorId != user) throw new CommunityFailure(403, "Only the author can change this direct message.");
        if (content is not null) await RequireContact(conversation, ct);
        var hash = Hash(new { action = content is null ? "delete" : "edit", id, messageId, version, content });
        var receipt = await db.DirectCommands.SingleOrDefaultAsync(c => c.UserId == user && c.ClientRequestId == requestId, ct);
        if (receipt is not null) { if (receipt.Hash != hash) throw new CommunityFailure(409, "This request ID was used for another conversation change."); }
        else
        {
            if (message.Deleted || Sequence(message.Version) != version) throw new CommunityFailure(409, "Message changed. Reload its current version before trying again.");
            message.Content = content ?? ""; message.Deleted = content is null; message.Version = checked(message.Version + 1); message.UpdatedAt = Now();
            db.DirectCommands.Add(new() { UserId = user, ClientRequestId = requestId, ConversationId = id, Hash = hash }); Event(conversation, content is null ? "message.deleted" : "message.edited", messageId); await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct); return MessageDto(message);
    }
}
