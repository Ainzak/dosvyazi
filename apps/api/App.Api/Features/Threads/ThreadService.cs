using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Threads;

public sealed class ThreadService(AppDbContext db, MessageService messages)
{
    private static CommunityFailure Missing() => new(404, "Thread or parent channel is unavailable.");
    private static string Version(long value) => value.ToString(CultureInfo.InvariantCulture);
    private static string Hash(object payload) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(payload)));
    private static string Title(string value)
    {
        var title = value.Trim();
        if (title.Length is < 2 or > 80 || title.Any(char.IsControl)) throw new CommunityFailure(422, "Use a thread title of 2–80 characters without control characters.");
        return title;
    }
    private async Task<(TextChannel Parent, EffectiveChannelAccess Access)> Parent(Guid community, Guid parent, Guid user, CancellationToken ct)
    {
        var channel = await messages.LockAuthorizedAsync(community, parent, user, ct);
        if (channel.Kind != "Text" || channel.ParentChannelId is not null) throw Missing();
        return (channel, await ChannelAccess.ResolveAsync(db, community, channel, user, ct));
    }
    private async Task<TextChannel> Child(Guid community, Guid parent, Guid thread, CancellationToken ct) =>
        await db.TextChannels.SingleOrDefaultAsync(c => c.Id == thread && c.CommunityId == community && c.ParentChannelId == parent && c.Kind == "MessageThread", ct) ?? throw Missing();

    private async Task<ThreadDto[]> Dtos(TextChannel[] threads, Guid user, EffectiveChannelAccess access, CancellationToken ct)
    {
        var ids = threads.Select(t => t.Id).ToArray();
        var counts = await db.Messages.AsNoTracking().Where(m => ids.Contains(m.ChannelId) && !m.Deleted).GroupBy(m => m.ChannelId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Id, g => g.Count, ct);
        var unread = await db.Messages.AsNoTracking().Where(m => ids.Contains(m.ChannelId) && !m.Deleted && m.AuthorId != user && m.Sequence > (db.ChannelReadStates.Where(r => r.ChannelId == m.ChannelId && r.UserId == user).Select(r => (long?)r.Sequence).SingleOrDefault() ?? 0))
            .GroupBy(m => m.ChannelId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Id, g => g.Count, ct);
        var roots = threads.Select(t => t.RootMessageId!.Value).ToArray();
        var deleted = await db.Messages.AsNoTracking().Where(m => roots.Contains(m.Id) && m.Deleted).Select(m => m.Id).ToArrayAsync(ct);
        return threads.Select(t => new ThreadDto(t.Id.ToString(), t.ParentChannelId!.Value.ToString(), t.RootMessageId!.Value.ToString(), t.Name, t.DiscussionCreatorId!.Value.ToString(), t.DiscussionCreatedAt!.Value,
            t.DiscussionArchived, Version(t.DiscussionVersion), Version(t.DiscussionSequence), counts.GetValueOrDefault(t.Id), unread.GetValueOrDefault(t.Id), access.Send && !t.DiscussionArchived,
            access.Has(ChannelAccess.ManageMessages) || (t.DiscussionCreatorId == user && access.Send), deleted.Contains(t.RootMessageId.Value))).ToArray();
    }
    public async Task<ThreadPage> List(Guid community, Guid parent, Guid user, string? before, string? roots, bool archived, string? query, CancellationToken ct)
    {
        if (query?.Length > 80 || query?.Any(char.IsControl) == true) throw new CommunityFailure(422, "Search thread titles with up to 80 characters.");
        long boundary = 1001;
        if (before is not null && (!long.TryParse(before, NumberStyles.None, CultureInfo.InvariantCulture, out boundary) || boundary is < 1 or > 1001)) throw new CommunityFailure(422, "Use a valid thread list cursor.");
        Guid[]? rootIds = null;
        if (roots is not null)
        {
            var parts = roots.Split(',');
            if (parts.Length is < 1 or > 100 || parts.Any(p => !Guid.TryParse(p, out _))) throw new CommunityFailure(422, "Request up to 100 root messages.");
            rootIds = parts.Select(Guid.Parse).Distinct().ToArray();
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (_, access) = await Parent(community, parent, user, ct);
        var items = db.TextChannels.AsNoTracking().Where(t => t.CommunityId == community && t.ParentChannelId == parent && t.Kind == "MessageThread");
        items = rootIds is null ? items.Where(t => t.DiscussionSequence < boundary && t.DiscussionArchived == archived && (query == null || t.Name.ToLower().Contains(query.ToLower()))) : items.Where(t => rootIds.Contains(t.RootMessageId!.Value));
        var rows = await items.OrderByDescending(t => t.DiscussionSequence).Take(rootIds is null ? 51 : 100).ToArrayAsync(ct);
        var visible = rootIds is null ? rows.Take(50).ToArray() : rows;
        var result = new ThreadPage(await Dtos(visible, user, access, ct), visible.LastOrDefault() is { } last ? Version(last.DiscussionSequence) : null, rootIds is null && rows.Length > 50);
        await tx.CommitAsync(ct); return result;
    }
    public async Task<ThreadDto> Get(Guid community, Guid parent, Guid thread, Guid user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (_, access) = await Parent(community, parent, user, ct);
        var child = await Child(community, parent, thread, ct);
        var result = (await Dtos([child], user, access, ct))[0];
        await tx.CommitAsync(ct); return result;
    }
    private async Task<ThreadCommand?> Prior(Guid parent, Guid user, Guid request, string hash, CancellationToken ct)
    {
        if (request == Guid.Empty) throw new CommunityFailure(422, "Use a thread request ID.");
        var prior = await db.ThreadCommands.SingleOrDefaultAsync(c => c.ParentChannelId == parent && c.ActorId == user && c.ClientRequestId == request, ct);
        if (prior is not null && prior.Hash != hash) throw new CommunityFailure(409, "This request ID was used for another thread change.");
        return prior;
    }
    public async Task<ThreadDto> Create(Guid community, Guid parent, Guid user, CreateThreadRequest request, CancellationToken ct)
    {
        var title = Title(request.Title); var hash = Hash(new { action = "create", request.RootMessageId, title });
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (channel, access) = await Parent(community, parent, user, ct);
        if (!access.Send) throw new CommunityFailure(403, "You cannot create threads in this channel.");
        var prior = await Prior(parent, user, request.ClientRequestId, hash, ct);
        TextChannel child;
        if (prior is not null) child = await Child(community, parent, prior.ThreadId, ct);
        else
        {
            if (!await db.Messages.AnyAsync(m => m.Id == request.RootMessageId && m.ChannelId == parent && !m.Deleted, ct)) throw new CommunityFailure(404, "Thread source message is unavailable.");
            if (await db.TextChannels.AnyAsync(t => t.ParentChannelId == parent && t.RootMessageId == request.RootMessageId, ct)) throw new CommunityFailure(409, "A thread already exists for this message. Open the existing thread.");
            if (channel.LastDiscussionNumber >= 1000) throw new CommunityFailure(409, "This channel has reached its thread limit.");
            child = new TextChannel { Kind = "MessageThread", Id = Guid.NewGuid(), CommunityId = community, ParentChannelId = parent, RootMessageId = request.RootMessageId,
                Name = title, DiscussionCreatorId = user, DiscussionCreatedAt = DateTimeOffset.UtcNow, DiscussionSequence = ++channel.LastDiscussionNumber };
            db.TextChannels.Add(child);
            db.ThreadCommands.Add(new() { ParentChannelId = parent, ActorId = user, ClientRequestId = request.ClientRequestId, ThreadId = child.Id, Hash = hash });
            CommunityAudit.Add(db, community, user, "thread.created", child.Id);
            await db.SaveChangesAsync(ct);
        }
        var result = (await Dtos([child], user, access, ct))[0];
        await tx.CommitAsync(ct); return result;
    }
    public async Task<ThreadDto> Change(Guid community, Guid parent, Guid thread, Guid user, ChangeThreadRequest request, CancellationToken ct)
    {
        var title = Title(request.Title); var hash = Hash(new { action = "change", thread, request.ExpectedVersion, title, request.Archived });
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (_, access) = await Parent(community, parent, user, ct);
        var child = await Child(community, parent, thread, ct);
        if (!access.Has(ChannelAccess.ManageMessages) && !(child.DiscussionCreatorId == user && access.Send)) throw new CommunityFailure(403, "Only the thread creator with send access or a message moderator can manage this thread.");
        var prior = await Prior(parent, user, request.ClientRequestId, hash, ct);
        if (prior is null)
        {
            if (request.ExpectedVersion != Version(child.DiscussionVersion)) throw new CommunityFailure(409, "This thread changed. Reload its saved settings before changing it.");
            if (child.Name != title || child.DiscussionArchived != request.Archived)
            {
                child.Name = title; child.DiscussionArchived = request.Archived; child.DiscussionVersion = checked(child.DiscussionVersion + 1);
                CommunityAudit.Add(db, community, user, request.Archived ? "thread.archived" : "thread.updated", child.Id);
            }
            db.ThreadCommands.Add(new() { ParentChannelId = parent, ActorId = user, ClientRequestId = request.ClientRequestId, ThreadId = thread, Hash = hash });
            await db.SaveChangesAsync(ct);
        }
        var result = (await Dtos([child], user, access, ct))[0];
        await tx.CommitAsync(ct); return result;
    }
}
