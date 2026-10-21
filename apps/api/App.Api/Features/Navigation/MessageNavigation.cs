using System.Security.Cryptography;
using System.Text.Json;
using App.Api.Features.Communities;
using App.Api.Features.DirectMessages;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Navigation;

// Invoked inside the existing send transaction and resource lock. Only references, never quotation copies.
public static class MessageNavigation
{
    public static Guid[] Mentions(SendMessageRequest request)
    {
        var ids = request.MentionUserIds ?? [];
        if (request.ReplyToId == Guid.Empty || ids.Length > 10 || ids.Contains(Guid.Empty) || ids.Distinct().Count() != ids.Length)
            throw new CommunityFailure(422, "Choose up to 10 distinct members and an available reply source.");
        return ids.Order().ToArray();
    }
    public static string RequestHash(string original, SendMessageRequest request, Guid[] mentions) => request.ReplyToId is null && mentions.Length == 0 ? original
        : Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { original, request.ReplyToId, mentions })));

    public static async Task ChannelAsync(AppDbContext db, TextChannel channel, Message message, CancellationToken ct)
    {
        Guid? replyAuthor = null;
        if (message.ReplyToId.HasValue)
            replyAuthor = await db.Messages.Where(m => m.Id == message.ReplyToId && m.ChannelId == channel.Id && !m.Deleted).Select(m => (Guid?)m.AuthorId).SingleOrDefaultAsync(ct)
                ?? throw new CommunityFailure(404, "Reply source is unavailable.");
        foreach (var user in message.MentionUserIds)
            if (!(await ChannelAccess.ResolveAsync(db, channel.CommunityId, channel, user, ct)).View)
                throw new CommunityFailure(422, "A mentioned member cannot view this conversation.");
        var all = await db.ConversationPreferences.Where(p => p.Kind == "channel" && p.ContainerId == channel.Id && p.Mode == "all").Select(p => p.UserId).ToArrayAsync(ct);
        foreach (var user in all.Concat(message.MentionUserIds).Concat(replyAuthor.HasValue ? [replyAuthor.Value] : Array.Empty<Guid>()).Distinct())
        {
            if (user == message.AuthorId || !(await ChannelAccess.ResolveAsync(db, channel.CommunityId, channel, user, ct)).View) continue;
            await NoticeAsync(db, user, "channel", channel.Id, message.Id, message.CreatedAt, message.MentionUserIds.Contains(user) || replyAuthor == user, ct);
        }
    }
    public static async Task DirectAsync(AppDbContext db, DirectConversation conversation, DirectMessage message, CancellationToken ct)
    {
        Guid? replyAuthor = null;
        if (message.ReplyToId.HasValue)
            replyAuthor = await db.DirectMessages.Where(m => m.Id == message.ReplyToId && m.ConversationId == conversation.Id && !m.Deleted).Select(m => (Guid?)m.AuthorId).SingleOrDefaultAsync(ct)
                ?? throw new CommunityFailure(404, "Reply source is unavailable.");
        if (message.MentionUserIds.Any(u => u != conversation.LowerUserId && u != conversation.UpperUserId)) throw new CommunityFailure(422, "A mentioned member cannot view this conversation.");
        var other = message.AuthorId == conversation.LowerUserId ? conversation.UpperUserId : conversation.LowerUserId;
        await NoticeAsync(db, other, "direct", conversation.Id, message.Id, message.CreatedAt, message.MentionUserIds.Contains(other) || replyAuthor == other, ct);
    }
    private static async Task NoticeAsync(AppDbContext db, Guid user, string kind, Guid container, Guid message, DateTimeOffset created, bool mention, CancellationToken ct)
    {
        var mode = await db.ConversationPreferences.Where(p => p.UserId == user && p.Kind == kind && p.ContainerId == container).Select(p => p.Mode).SingleOrDefaultAsync(ct) ?? (kind == "direct" ? "all" : "mentions");
        if (mode == "quiet" || (mode == "mentions" && !mention)) return;
        db.MessageNotices.Add(new() { Id = Guid.NewGuid(), UserId = user, Kind = kind, ContainerId = container, MessageId = message, CreatedAt = created, Mention = mention });
    }
}
