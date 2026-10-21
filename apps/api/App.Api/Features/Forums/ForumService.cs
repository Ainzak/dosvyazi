using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Features.Navigation;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Forums;

public sealed class ForumService(AppDbContext db, MessageService messages)
{
    private static CommunityFailure Missing() => new(404, "Forum or topic is unavailable.");
    private static string Version(long value) => value.ToString(CultureInfo.InvariantCulture);
    private static string Hash(object payload) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(payload)));
    private static string Title(string value)
    {
        var title = value.Trim();
        if (title.Length is < 2 or > 80 || title.Any(char.IsControl)) throw new CommunityFailure(422, "Use a forum topic title of 2–80 characters without control characters.");
        return title;
    }
    private async Task<(TextChannel Forum, EffectiveChannelAccess Access)> Parent(Guid community, Guid forum, Guid user, CancellationToken ct)
    {
        var channel = await messages.LockAuthorizedAsync(community, forum, user, ct, allowForum: true);
        if (channel.Kind != "Forum" || channel.ParentChannelId is not null) throw Missing();
        return (channel, await ChannelAccess.ResolveAsync(db, community, channel, user, ct));
    }
    private async Task<TextChannel> Topic(Guid community, Guid forum, Guid topic, CancellationToken ct) =>
        await db.TextChannels.SingleOrDefaultAsync(c => c.Id == topic && c.CommunityId == community && c.ParentChannelId == forum && c.Kind == "ForumTopic", ct) ?? throw Missing();
    private async Task<ForumTopicDto[]> Dtos(TextChannel[] topics, Guid user, EffectiveChannelAccess access, CancellationToken ct)
    {
        if (topics.Length == 0) return [];
        var ids = topics.Select(t => t.Id).ToArray();
        var counts = await db.Messages.AsNoTracking().Where(m => ids.Contains(m.ChannelId) && !m.Deleted).GroupBy(m => m.ChannelId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Id, g => g.Count, ct);
        var unread = await db.Messages.AsNoTracking().Where(m => ids.Contains(m.ChannelId) && !m.Deleted && m.AuthorId != user && m.Sequence > (db.ChannelReadStates.Where(r => r.ChannelId == m.ChannelId && r.UserId == user).Select(r => (long?)r.Sequence).SingleOrDefault() ?? 0))
            .GroupBy(m => m.ChannelId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Id, g => g.Count, ct);
        return topics.Select(t => new ForumTopicDto(t.Id.ToString(), t.ParentChannelId!.Value.ToString(), t.Name, t.DiscussionCreatorId!.Value.ToString(), t.DiscussionCreatedAt!.Value,
            t.DiscussionArchived, Version(t.DiscussionVersion), Version(t.DiscussionSequence), counts.GetValueOrDefault(t.Id), unread.GetValueOrDefault(t.Id), access.Send && !t.DiscussionArchived,
            access.Has(ChannelAccess.ManageMessages) || (t.DiscussionCreatorId == user && access.Send))).ToArray();
    }
    public async Task<ForumTopicPage> List(Guid community, Guid forum, Guid user, string? before, bool archived, string? query, CancellationToken ct)
    {
        if (query?.Length > 80 || query?.Any(char.IsControl) == true) throw new CommunityFailure(422, "Search topic titles with up to 80 characters.");
        long boundary = 1001;
        if (before is not null && (!long.TryParse(before, NumberStyles.None, CultureInfo.InvariantCulture, out boundary) || boundary is < 1 or > 1001)) throw new CommunityFailure(422, "Use a valid forum topic cursor.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (_, access) = await Parent(community, forum, user, ct);
        var rows = await db.TextChannels.AsNoTracking().Where(t => t.CommunityId == community && t.ParentChannelId == forum && t.Kind == "ForumTopic" && t.DiscussionSequence < boundary && t.DiscussionArchived == archived && (query == null || t.Name.ToLower().Contains(query.ToLower())))
            .OrderByDescending(t => t.DiscussionSequence).Take(51).ToArrayAsync(ct);
        var visible = rows.Take(50).ToArray();
        var result = new ForumTopicPage(await Dtos(visible, user, access, ct), visible.LastOrDefault() is { } last ? Version(last.DiscussionSequence) : null, rows.Length > 50);
        await tx.CommitAsync(ct); return result;
    }
    public async Task<ForumTopicDto> Get(Guid community, Guid forum, Guid topic, Guid user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var (_, access) = await Parent(community, forum, user, ct);
        var result = (await Dtos([await Topic(community, forum, topic, ct)], user, access, ct))[0]; await tx.CommitAsync(ct); return result;
    }
    private async Task<ForumTopicCommand?> Prior(Guid forum, Guid user, Guid request, string hash, CancellationToken ct)
    {
        if (request == Guid.Empty) throw new CommunityFailure(422, "Use a forum topic request ID.");
        var prior = await db.ForumTopicCommands.SingleOrDefaultAsync(c => c.ForumId == forum && c.ActorId == user && c.ClientRequestId == request, ct);
        if (prior is not null && prior.Hash != hash) throw new CommunityFailure(409, "This request ID was used for another forum topic change.");
        return prior;
    }
    public async Task<ForumTopicDto> Create(Guid community, Guid forum, Guid user, CreateForumTopicRequest request, CancellationToken ct)
    {
        var title = Title(request.Title); var content = request.Content;
        if (string.IsNullOrWhiteSpace(content) || content.Length > 4000 || content.Any(c => char.IsControl(c) && c is not '\n' and not '\r' and not '\t')) throw new CommunityFailure(422, "Write a first post of 1–4000 characters.");
        var hash = Hash(new { action = "create", title, content });
        await using var tx = await db.Database.BeginTransactionAsync(ct); var (parent, access) = await Parent(community, forum, user, ct);
        if (!access.Send) throw new CommunityFailure(403, "You cannot create topics in this forum.");
        var prior = await Prior(forum, user, request.ClientRequestId, hash, ct); TextChannel topic;
        if (prior is not null) topic = await Topic(community, forum, prior.TopicId, ct);
        else
        {
            if (parent.LastDiscussionNumber >= 1000) throw new CommunityFailure(409, "This forum has reached its topic limit.");
            var now = DateTimeOffset.UtcNow; now = now.AddTicks(-(now.Ticks % 10));
            topic = new TextChannel { Id = Guid.NewGuid(), CommunityId = community, ParentChannelId = forum, Kind = "ForumTopic", Name = title,
                DiscussionCreatorId = user, DiscussionCreatedAt = now, DiscussionSequence = ++parent.LastDiscussionNumber, LastSequence = 1 };
            db.TextChannels.Add(topic);
            var message = new Message { Id = Guid.NewGuid(), ChannelId = topic.Id, AuthorId = user, ClientMessageId = request.ClientRequestId, Sequence = 1, Content = content,
                OriginalContentHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(content))), CreatedAt = now, Author = await db.Users.SingleAsync(u => u.Id == user, ct) };
            db.Messages.Add(message); var change = new ChannelEvent { Id = Guid.NewGuid(), ChannelId = topic.Id, Sequence = 1, Message = message, CreatedAt = now };
            db.ChannelEvents.Add(change); db.OutboxEntries.Add(new OutboxEntry { Id = Guid.NewGuid(), Event = change });
            await MessageNavigation.ChannelAsync(db, topic, message, ct);
            db.ForumTopicCommands.Add(new() { ForumId = forum, ActorId = user, ClientRequestId = request.ClientRequestId, TopicId = topic.Id, Hash = hash });
            CommunityAudit.Add(db, community, user, "forum-topic.created", topic.Id); await db.SaveChangesAsync(ct);
        }
        var result = (await Dtos([topic], user, access, ct))[0]; await tx.CommitAsync(ct); return result;
    }
    public async Task<ForumTopicDto> Change(Guid community, Guid forum, Guid topic, Guid user, ChangeForumTopicRequest request, CancellationToken ct)
    {
        var title = Title(request.Title); var hash = Hash(new { action = "change", topic, request.ExpectedVersion, title, request.Archived });
        await using var tx = await db.Database.BeginTransactionAsync(ct); var (_, access) = await Parent(community, forum, user, ct); var entity = await Topic(community, forum, topic, ct);
        if (!access.Has(ChannelAccess.ManageMessages) && !(entity.DiscussionCreatorId == user && access.Send)) throw new CommunityFailure(403, "Only the topic creator with send access or a message moderator can manage this topic.");
        var prior = await Prior(forum, user, request.ClientRequestId, hash, ct);
        if (prior is null)
        {
            if (request.ExpectedVersion != Version(entity.DiscussionVersion)) throw new CommunityFailure(409, "This forum topic changed. Reload its saved settings before changing it.");
            if (entity.Name != title || entity.DiscussionArchived != request.Archived)
            {
                entity.Name = title; entity.DiscussionArchived = request.Archived; entity.DiscussionVersion = checked(entity.DiscussionVersion + 1);
                CommunityAudit.Add(db, community, user, request.Archived ? "forum-topic.archived" : "forum-topic.updated", topic);
            }
            db.ForumTopicCommands.Add(new() { ForumId = forum, ActorId = user, ClientRequestId = request.ClientRequestId, TopicId = topic, Hash = hash }); await db.SaveChangesAsync(ct);
        }
        var result = (await Dtos([entity], user, access, ct))[0]; await tx.CommitAsync(ct); return result;
    }
}
