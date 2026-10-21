using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using App.Api.Features.Communities;
using App.Api.Features.DirectMessages;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Navigation;

public sealed record SourceDto(string Kind, string ContainerId, string MessageId, string AuthorId, string AuthorName, string Content, string Href, string? ReplyToId, string[] MentionUserIds, AttachmentDto? Attachment = null);
public sealed record MentionMember(string Id, string Name);
public sealed record PreferenceDto(string Mode);
public sealed record PreferenceRequest(Guid ClientRequestId, [Required] string Mode);
public sealed record BookmarkRequest(Guid ClientRequestId, [Required] string Kind, Guid ContainerId, Guid MessageId, [Required(AllowEmptyStrings = true), StringLength(500)] string Note, [Required] string[] Tags, bool Removed = false);
public sealed record BookmarkDto(string Id, string Kind, string ContainerId, string MessageId, string Note, string[] Tags, SourceDto? Source);
public sealed record BookmarkPage(BookmarkDto[] Items, string? Before, bool HasMore);
public sealed record NoticeDto(string Id, bool Mention, bool Read, DateTimeOffset CreatedAt, SourceDto Source);
public sealed record NoticePage(NoticeDto[] Items, string? Before, bool HasMore);
public sealed record NoticeReadRequest(Guid ClientRequestId, bool Read);

public sealed class NavigationService(AppDbContext db, MessageService messages, DirectService direct)
{
    private static CommunityFailure Missing() => new(404, "Message source is unavailable.");
    private static string Hash(object value) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private async Task<Guid?> ScopeAsync(string kind, Guid container, Guid user, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (kind == "direct") { await direct.LockAsync(container, principal, ct); return null; }
        if (kind != "channel") throw new CommunityFailure(422, "Choose a channel or direct conversation.");
        var community = await db.TextChannels.AsNoTracking().Where(c => c.Id == container).Select(c => (Guid?)c.CommunityId).SingleOrDefaultAsync(ct) ?? throw Missing();
        await messages.LockAuthorizedAsync(community, container, user, ct); return community;
    }
    // Each displayed source has its own short transaction and fresh access check. No copied quotations survive revocation.
    public async Task<SourceDto> SourceAsync(string kind, Guid container, Guid message, ClaimsPrincipal principal, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        await using var tx = await db.Database.BeginTransactionAsync(ct); var user = await direct.SessionAsync(principal, ct);
        var community = await ScopeAsync(kind, container, user, principal, ct);
        SourceDto result;
        if (kind == "channel")
        {
            var row = await db.Messages.AsNoTracking().Include(m => m.Author).Include(m => m.Attachment).SingleOrDefaultAsync(m => m.Id == message && m.ChannelId == container && !m.Deleted, ct) ?? throw Missing();
            var channel = await db.TextChannels.AsNoTracking().SingleAsync(c => c.Id == container, ct);
            var href = channel.Kind == "ForumTopic" ? $"/communities/{community}/forums/{channel.ParentChannelId}/topics/{container}?message={message}"
                : channel.ParentChannelId is Guid parentId ? $"/communities/{community}/channels/{parentId}/threads/{container}?message={message}" : $"/communities/{community}/channels/{container}?message={message}";
            result = new(kind, container.ToString(), message.ToString(), row.AuthorId.ToString(), row.Author.DisplayName, row.Content,
                href, row.ReplyToId?.ToString(), row.MentionUserIds.Select(x => x.ToString()).ToArray(), MessageService.Dto(row).Attachment);
        }
        else
        {
            var row = await db.DirectMessages.AsNoTracking().Include(m => m.Author).Include(m => m.Attachment).SingleOrDefaultAsync(m => m.Id == message && m.ConversationId == container && !m.Deleted, ct) ?? throw Missing();
            result = new(kind, container.ToString(), message.ToString(), row.AuthorId.ToString(), row.Author.DisplayName, row.Content,
                $"/messages/{container}?message={message}", row.ReplyToId?.ToString(), row.MentionUserIds.Select(x => x.ToString()).ToArray(), DirectService.MessageDto(row).Attachment);
        }
        await tx.CommitAsync(ct); return result;
    }
    public async Task<MentionMember[]> MembersAsync(string kind, Guid container, string? query, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (query?.Length > 40 || query?.Any(char.IsControl) == true) throw new CommunityFailure(422, "Search names with up to 40 characters.");
        await using var tx = await db.Database.BeginTransactionAsync(ct); var user = await direct.SessionAsync(principal, ct);
        var community = await ScopeAsync(kind, container, user, principal, ct); var result = new List<MentionMember>();
        if (kind == "direct")
        {
            var pair = await db.DirectConversations.AsNoTracking().SingleAsync(c => c.Id == container, ct);
            var other = pair.LowerUserId == user ? pair.UpperUserId : pair.LowerUserId;
            if (!await direct.BlockedAsync(pair, ct)) result.Add(new(other.ToString(), await db.Users.Where(u => u.Id == other).Select(u => u.DisplayName).SingleAsync(ct)));
        }
        else
        {
            var channel = await db.TextChannels.AsNoTracking().SingleAsync(c => c.Id == container, ct);
            var candidates = await db.Memberships.AsNoTracking().Where(m => m.CommunityId == community && m.Status == "Active" && m.UserId != user && (query == null || m.User.DisplayName.ToLower().Contains(query.ToLower())))
                .OrderBy(m => m.User.DisplayName).ThenBy(m => m.UserId).Select(m => new { m.UserId, m.User.DisplayName }).Take(100).ToArrayAsync(ct);
            foreach (var candidate in candidates)
            {
                if ((await ChannelAccess.ResolveAsync(db, community!.Value, channel, candidate.UserId, ct)).View) result.Add(new(candidate.UserId.ToString(), candidate.DisplayName));
                if (result.Count == 25) break;
            }
        }
        await tx.CommitAsync(ct); return result.ToArray();
    }
    private async Task<bool> CommandAsync(Guid user, Guid request, object payload, CancellationToken ct)
    {
        if (request == Guid.Empty) throw new CommunityFailure(422, "Use a request ID.");
        // Serialize only this actor's private commands; never lock recipient accounts from a community send.
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(73421892, hashtext({user.ToString()}))", ct);
        var hash = Hash(payload); var receipt = await db.NavigationCommands.SingleOrDefaultAsync(c => c.UserId == user && c.ClientRequestId == request, ct);
        if (receipt is not null) { if (receipt.Hash != hash) throw new CommunityFailure(409, "This request ID was used for another navigation change."); return false; }
        db.NavigationCommands.Add(new() { UserId = user, ClientRequestId = request, Hash = hash }); return true;
    }
    public async Task<PreferenceDto> PreferenceAsync(string kind, Guid container, ClaimsPrincipal principal, PreferenceRequest? request, CancellationToken ct)
    {
        if (request is not null && request.Mode is not "all" and not "mentions" and not "quiet") throw new CommunityFailure(422, "Choose all, mentions or quiet notifications.");
        await using var tx = await db.Database.BeginTransactionAsync(ct); var user = await direct.SessionAsync(principal, ct); await ScopeAsync(kind, container, user, principal, ct);
        var apply = request is not null && await CommandAsync(user, request.ClientRequestId, new { action = "preference", kind, container, request.Mode }, ct);
        var row = await db.ConversationPreferences.SingleOrDefaultAsync(p => p.UserId == user && p.Kind == kind && p.ContainerId == container, ct);
        if (apply)
        {
            if (row is null) { row = new() { UserId = user, Kind = kind, ContainerId = container }; db.ConversationPreferences.Add(row); }
            row.Mode = request!.Mode; await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct); return new(row?.Mode ?? (kind == "direct" ? "all" : "mentions"));
    }
    public async Task<bool> BookmarkAsync(BookmarkRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (request.Kind is not "channel" and not "direct" || request.ContainerId == Guid.Empty || request.MessageId == Guid.Empty || request.Note.Length > 500 || request.Note.Any(c => char.IsControl(c) && c is not '\n' and not '\r' and not '\t') || request.Tags.Length > 8 || request.Tags.Any(t => string.IsNullOrWhiteSpace(t) || t.Length > 24 || t.Any(char.IsControl)))
            throw new CommunityFailure(422, "Use up to 8 tags of 24 characters and a note up to 500 characters.");
        var tags = request.Tags.Select(t => t.Trim().ToLowerInvariant()).Distinct().Order().ToArray();
        // Check new references first without holding the private command lock across resource locks.
        var user = await direct.SessionAsync(principal, ct);
        if (!request.Removed) await SourceAsync(request.Kind, request.ContainerId, request.MessageId, principal, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (await CommandAsync(user, request.ClientRequestId, new { action = "bookmark", request.Kind, request.ContainerId, request.MessageId, request.Note, tags, request.Removed }, ct))
        {
            var row = await db.MessageBookmarks.SingleOrDefaultAsync(b => b.UserId == user && b.Kind == request.Kind && b.MessageId == request.MessageId, ct);
            if (row is not null && row.ContainerId != request.ContainerId) throw Missing();
            if (row is null && !request.Removed)
            {
                if (await db.MessageBookmarks.CountAsync(b => b.UserId == user && !b.Removed, ct) >= 1000) throw new CommunityFailure(409, "You can save up to 1000 bookmarks.");
                row = new() { Id = Guid.NewGuid(), UserId = user, Kind = request.Kind, ContainerId = request.ContainerId, MessageId = request.MessageId, CreatedAt = DateTimeOffset.UtcNow }; db.MessageBookmarks.Add(row);
            }
            if (row is not null) { row.Note = request.Note; row.Tags = tags; row.Removed = request.Removed; }
            await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct); return true;
    }
    public async Task<BookmarkPage> BookmarksAsync(ClaimsPrincipal principal, Guid? before, string? tag, string? query, CancellationToken ct)
    {
        if (tag?.Length > 24 || query?.Length > 100 || tag?.Any(char.IsControl) == true || query?.Any(char.IsControl) == true) throw new CommunityFailure(422, "Use a tag up to 24 characters and search up to 100 characters.");
        var user = await direct.SessionAsync(principal, ct);
        var rows = db.MessageBookmarks.AsNoTracking().Where(b => b.UserId == user && !b.Removed && (tag == null || b.Tags.Contains(tag.ToLower())) && (query == null || b.Note.ToLower().Contains(query.ToLower())));
        if (before.HasValue)
        {
            var anchor = await db.MessageBookmarks.AsNoTracking().SingleOrDefaultAsync(b => b.UserId == user && b.Id == before, ct) ?? throw Missing();
            rows = rows.Where(b => b.CreatedAt < anchor.CreatedAt || (b.CreatedAt == anchor.CreatedAt && b.Id.CompareTo(anchor.Id) < 0));
        }
        var page = await rows.OrderByDescending(b => b.CreatedAt).ThenByDescending(b => b.Id).Take(26).ToArrayAsync(ct); var items = new List<BookmarkDto>();
        foreach (var row in page.Take(25))
        {
            SourceDto? source = null;
            try { source = await SourceAsync(row.Kind, row.ContainerId, row.MessageId, principal, ct); }
            catch (CommunityFailure e) when (e.Status is 403 or 404) { }
            items.Add(new(row.Id.ToString(), row.Kind, row.ContainerId.ToString(), row.MessageId.ToString(), row.Note, row.Tags, source));
        }
        return new(items.ToArray(), page.Length > 25 ? page[24].Id.ToString() : null, page.Length > 25);
    }
    public async Task<BookmarkDto?> BookmarkInfoAsync(string kind, Guid container, Guid message, ClaimsPrincipal principal, CancellationToken ct)
    {
        var user = await direct.SessionAsync(principal, ct);
        var row = await db.MessageBookmarks.AsNoTracking().SingleOrDefaultAsync(b => b.UserId == user && b.Kind == kind && b.ContainerId == container && b.MessageId == message && !b.Removed, ct);
        return row is null ? null : new(row.Id.ToString(), row.Kind, row.ContainerId.ToString(), row.MessageId.ToString(), row.Note, row.Tags, null);
    }
    public async Task<NoticePage> NoticesAsync(ClaimsPrincipal principal, Guid? before, CancellationToken ct)
    {
        var user = await direct.SessionAsync(principal, ct);
        var query = db.MessageNotices.AsNoTracking().Where(n => n.UserId == user && !n.Read);
        if (before.HasValue)
        {
            var anchor = await db.MessageNotices.AsNoTracking().SingleOrDefaultAsync(n => n.UserId == user && n.Id == before, ct) ?? throw Missing();
            query = query.Where(n => n.CreatedAt < anchor.CreatedAt || (n.CreatedAt == anchor.CreatedAt && n.Id.CompareTo(anchor.Id) < 0));
        }
        var rows = await query.OrderByDescending(n => n.CreatedAt).ThenByDescending(n => n.Id).Take(51).ToArrayAsync(ct);
        var items = new List<NoticeDto>();
        foreach (var row in rows.Take(50))
        {
            try
            {
                var source = await SourceAsync(row.Kind, row.ContainerId, row.MessageId, principal, ct);
                var mode = await db.ConversationPreferences.AsNoTracking().Where(p => p.UserId == user && p.Kind == row.Kind && p.ContainerId == row.ContainerId).Select(p => p.Mode).SingleOrDefaultAsync(ct) ?? (row.Kind == "direct" ? "all" : "mentions");
                if (mode == "quiet" || (mode == "mentions" && !row.Mention)) continue;
                if (row.Kind == "direct" && await db.UserBlocks.AnyAsync(b => (b.UserId == user && b.BlockedUserId.ToString() == source.AuthorId) || (b.BlockedUserId == user && b.UserId.ToString() == source.AuthorId), ct)) continue;
                items.Add(new(row.Id.ToString(), row.Mention, row.Read, row.CreatedAt, source));
            }
            catch (CommunityFailure e) when (e.Status is 403 or 404) { }
        }
        return new(items.ToArray(), rows.Length > 50 ? rows[49].Id.ToString() : null, rows.Length > 50);
    }
    public async Task<bool> ReadNoticeAsync(Guid id, NoticeReadRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var user = await direct.SessionAsync(principal, ct);
        if (await CommandAsync(user, request.ClientRequestId, new { action = "notice-read", id, request.Read }, ct))
        {
            var row = await db.MessageNotices.SingleOrDefaultAsync(n => n.Id == id && n.UserId == user, ct) ?? throw Missing(); row.Read = request.Read; await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct); return true;
    }
}
