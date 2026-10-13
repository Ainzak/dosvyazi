using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using App.Api.Features.Communities;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Gatherings;

public sealed partial class GatheringService(AppDbContext db, TimeProvider clock)
{
    public async Task LockCommunity(Guid community, Guid user, CancellationToken ct)
    {
        if (!await db.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(ct) ||
            !await db.Memberships.AnyAsync(m => m.CommunityId == community && m.UserId == user && m.Status == "Active", ct))
            throw new CommunityFailure(404, "Community or gathering is unavailable.");
    }
    public static async Task<bool> CanView(AppDbContext db, Gathering g, Guid user, CancellationToken ct)
    {
        if (!await db.Memberships.AnyAsync(m => m.CommunityId == g.CommunityId && m.UserId == user && m.Status == "Active", ct)) return false;
        return g.OrganizerId == user || await db.GatheringInvites.AnyAsync(i => i.GatheringId == g.Id && i.UserId == user && i.Active, ct) ||
            ((await ChannelAccess.BaseAsync(db, g.CommunityId, user, ct)).Permissions & ChannelAccess.ManageRoles) != 0;
    }
    private async Task<bool> CanManage(Gathering g, Guid user, CancellationToken ct) => g.OrganizerId == user ||
        ((await ChannelAccess.BaseAsync(db, g.CommunityId, user, ct)).Permissions & ChannelAccess.ManageRoles) != 0;
    public async Task<Gathering> Authorized(Guid community, Guid id, Guid user, CancellationToken ct, bool manage = false)
    {
        await LockCommunity(community, user, ct);
        var g = await db.Gatherings.Include(x => x.Invites).SingleOrDefaultAsync(x => x.Id == id && x.CommunityId == community, ct);
        if (g is null || !await CanView(db, g, user, ct)) throw new CommunityFailure(404, "Community or gathering is unavailable.");
        if (manage && !await CanManage(g, user, ct)) throw new CommunityFailure(403, "Only the organizer or a community moderator can manage this gathering.");
        return g;
    }
    private async Task<GatheringDto> Dto(Gathering g, Guid user, CancellationToken ct, bool discussion = true)
    {
        var ids = g.Invites.Where(i => i.Active).Select(i => i.UserId).Append(g.OrganizerId).ToArray();
        var members = await db.Memberships.Where(m => m.CommunityId == g.CommunityId && m.Status == "Active" && ids.Contains(m.UserId)).Select(m => m.UserId).ToArrayAsync(ct);
        var names = await db.Users.Where(u => ids.Contains(u.Id)).Select(u => new { u.Id, u.DisplayName }).ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
        var comments = discussion ? await db.GatheringComments.AsNoTracking().Where(c => c.GatheringId == g.Id).OrderBy(c => c.Sequence)
            .Select(c => new GatheringCommentDto(c.Id.ToString(), c.AuthorId.ToString(), db.Users.Where(u => u.Id == c.AuthorId).Select(u => u.DisplayName).Single(), c.Revision, c.Text, c.CreatedAt)).ToArrayAsync(ct) : [];
        return new(g.Id.ToString(), g.CommunityId.ToString(), g.OrganizerId.ToString(), names[g.OrganizerId], g.Title, g.Description, g.Game,
            g.LocalStart, g.TimeZoneId, g.StartAt, g.Status, g.Revision, g.Version.ToString(CultureInfo.InvariantCulture), g.CoverId?.ToString(),
            await CanManage(g, user, ct), g.Status == "Scheduled" && g.Invites.Any(i => i.UserId == user && i.Active),
            g.Invites.Where(i => i.Active).OrderBy(i => i.UserId).Select(i => new GatheringInviteDto(i.UserId.ToString(), names[i.UserId], i.State, members.Contains(i.UserId))).ToArray(), comments);
    }
    public async Task<GatheringDto> Get(Guid community, Guid id, Guid user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct);
        var result = await Dto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<GatheringList> List(Guid community, Guid user, int offset, CancellationToken ct)
    {
        if (offset is < 0 or > 100000) throw new CommunityFailure(422, "Use a valid list position.");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockCommunity(community, user, ct);
        var manage = ((await ChannelAccess.BaseAsync(db, community, user, ct)).Permissions & ChannelAccess.ManageRoles) != 0;
        var items = await db.Gatherings.Include(g => g.Invites).Where(g => g.CommunityId == community && (manage || g.OrganizerId == user || g.Invites.Any(i => i.UserId == user && i.Active)))
            .OrderByDescending(g => g.CreatedAt).ThenBy(g => g.Id).Skip(offset).Take(21).ToArrayAsync(ct);
        var result = new List<GatheringDto>(); foreach (var g in items.Take(20)) result.Add(await Dto(g, user, ct, false));
        await tx.CommitAsync(ct); return new(result.ToArray(), items.Length > 20, offset + result.Count);
    }
    public async Task<GatheringCandidates> Candidates(Guid community, Guid user, int offset, CancellationToken ct)
    {
        if (offset is < 0 or > 100000) throw new CommunityFailure(422, "Use a valid list position.");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockCommunity(community, user, ct);
        var rows = await db.Memberships.Where(m => m.CommunityId == community && m.Status == "Active" && m.UserId != user)
            .OrderBy(m => m.UserId).Skip(offset).Take(101).Select(m => new GatheringCandidate(m.UserId.ToString(), m.User.DisplayName)).ToArrayAsync(ct);
        await tx.CommitAsync(ct); return new(rows.Take(100).ToArray(), rows.Length > 100, offset + Math.Min(rows.Length, 100));
    }
    private static string Hash(object request) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(request)));
    private async Task<GatheringCommand?> Prior(Guid community, Guid user, Guid request, string hash, CancellationToken ct)
    {
        if (request == Guid.Empty) throw new CommunityFailure(422, "Use a gathering request ID.");
        var prior = await db.GatheringCommands.SingleOrDefaultAsync(c => c.CommunityId == community && c.ActorId == user && c.ClientRequestId == request, ct);
        if (prior is not null && prior.Hash != hash) throw new CommunityFailure(409, "This request ID was used with a different gathering action.");
        return prior;
    }
    private void Command(Gathering g, Guid user, Guid request, string hash) => db.GatheringCommands.Add(new() { CommunityId = g.CommunityId, GatheringId = g.Id, ActorId = user, ClientRequestId = request, Hash = hash });
    private static void Version(Gathering g, string expected)
    {
        if (expected != g.Version.ToString(CultureInfo.InvariantCulture)) throw new CommunityFailure(409, "Gathering changed. Reload it before trying again.");
    }
    private static void Scheduled(Gathering g)
    {
        if (g.Status != "Scheduled") throw new CommunityFailure(409, "This gathering is closed. Responses and changes are disabled.");
    }
    private static void Text(string value, int max)
    {
        if (value is null || value.Length > max || value.Any(c => char.IsControl(c) && c is not '\n' and not '\r' and not '\t')) throw new CommunityFailure(422, "Use bounded plain text without control characters.");
    }
    public static DateTimeOffset ResolveTime(string local, string zone)
    {
        if (!DateTime.TryParseExact(local, "yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) throw new CommunityFailure(422, "Choose a date and time and an explicit time zone.");
        try
        {
            var tz = TimeZoneInfo.FindSystemTimeZoneById(zone);
            date = DateTime.SpecifyKind(date, DateTimeKind.Unspecified);
            if (tz.IsInvalidTime(date) || tz.IsAmbiguousTime(date)) throw new CommunityFailure(422, "This local time is invalid or ambiguous because of daylight saving. Choose an unambiguous time.");
            return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(date, tz), TimeSpan.Zero);
        }
        catch (TimeZoneNotFoundException) { throw new CommunityFailure(422, "Use a valid time zone, such as Europe/Moscow or UTC."); }
        catch (InvalidTimeZoneException) { throw new CommunityFailure(422, "Use a valid time zone, such as Europe/Moscow or UTC."); }
        catch (ArgumentException) { throw new CommunityFailure(422, "Choose a valid local date, time and time zone."); }
    }
    private async Task<DateTimeOffset> ValidatePlan(Guid community, Guid organizer, GatheringPlanRequest r, CancellationToken ct)
    {
        Text(r.Title, 80); Text(r.Description, 2000); Text(r.Game, 80);
        if (r.Participants is null || r.Participants.Length is < 1 or > 50 || r.Participants.Distinct().Count() != r.Participants.Length || r.Participants.Contains(organizer) || r.Participants.Contains(Guid.Empty))
            throw new CommunityFailure(422, "Select 1–50 different current members other than the organizer.");
        if (await db.Memberships.CountAsync(m => m.CommunityId == community && m.Status == "Active" && r.Participants.Contains(m.UserId), ct) != r.Participants.Length)
            throw new CommunityFailure(422, "One or more invitees are no longer community members. Refresh the member list.");
        return ResolveTime(r.LocalStart, r.TimeZoneId);
    }
    private void Apply(Gathering g, GatheringPlanRequest r, DateTimeOffset start)
    {
        g.Title = string.IsNullOrWhiteSpace(r.Title) ? "Gathering" : r.Title.Trim(); g.Description = r.Description.Trim(); g.Game = r.Game.Trim();
        g.LocalStart = r.LocalStart; g.TimeZoneId = r.TimeZoneId; g.StartAt = start;
        foreach (var i in g.Invites) { var active = r.Participants.Contains(i.UserId); if (active && !i.Active) i.State = "Pending"; i.Active = active; }
        foreach (var id in r.Participants.Where(id => g.Invites.All(i => i.UserId != id))) g.Invites.Add(new() { UserId = id });
    }
    private void Archive(Gathering g) => db.GatheringRevisions.Add(new() { GatheringId = g.Id, Revision = g.Revision,
        PlanJson = JsonSerializer.Serialize(new { g.Title, g.Description, g.Game, g.LocalStart, g.TimeZoneId, g.StartAt }),
        ResponsesJson = JsonSerializer.Serialize(g.Invites.Where(i => i.Active).Select(i => new { i.UserId, i.State })) });
    private void Changed(Gathering g, Guid actor, string kind, Guid[]? removed = null)
    {
        db.GatheringEvents.Add(new() { Id = Guid.NewGuid(), GatheringId = g.Id, CommunityId = g.CommunityId, Version = g.Version, RemovedUsersJson = JsonSerializer.Serialize(removed ?? []) });
        foreach (var user in g.Invites.Where(i => i.Active).Select(i => i.UserId).Append(g.OrganizerId).Distinct())
            db.GatheringNotices.Add(new() { Id = Guid.NewGuid(), GatheringId = g.Id, UserId = user, Kind = kind, Revision = g.Revision, Version = g.Version, CreatedAt = clock.GetUtcNow() });
        CommunityAudit.Add(db, g.CommunityId, actor, "gathering." + kind, g.Id);
    }
    public async Task<GatheringDto> Create(Guid community, Guid user, GatheringPlanRequest r, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockCommunity(community, user, ct);
        var hash = Hash(new { create = r }); var prior = await Prior(community, user, r.ClientRequestId, hash, ct);
        if (prior is not null) { var existing = await Authorized(community, prior.GatheringId, user, ct); var replay = await Dto(existing, user, ct); await tx.CommitAsync(ct); return replay; }
        if (r.ExpectedVersion != "0") throw new CommunityFailure(422, "Use version zero for a new gathering.");
        var start = await ValidatePlan(community, user, r, ct); if (start <= clock.GetUtcNow()) throw new CommunityFailure(422, "Schedule a new gathering in the future.");
        if (await db.Gatherings.CountAsync(g => g.CommunityId == community && g.Status == "Scheduled", ct) >= 100) throw new CommunityFailure(409, "This community has reached its scheduled gathering limit.");
        var g = new Gathering { Id = Guid.NewGuid(), CommunityId = community, OrganizerId = user, CreatedAt = clock.GetUtcNow() }; Apply(g, r, start);
        db.Gatherings.Add(g); Command(g, user, r.ClientRequestId, hash); Changed(g, user, "created"); await db.SaveChangesAsync(ct);
        var result = await Dto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<GatheringDto> Edit(Guid community, Guid id, Guid user, GatheringPlanRequest r, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct, true); var hash = Hash(new { edit = id, r });
        if (await Prior(community, user, r.ClientRequestId, hash, ct) is null)
        {
            Version(g, r.ExpectedVersion); Scheduled(g); var start = await ValidatePlan(community, g.OrganizerId, r, ct);
            if (start != g.StartAt && start <= clock.GetUtcNow()) throw new CommunityFailure(422, "Schedule a changed start in the future.");
            var removed = g.Invites.Where(i => i.Active && !r.Participants.Contains(i.UserId)).Select(i => i.UserId).ToArray();
            var material = start != g.StartAt || r.Game.Trim() != g.Game;
            if (material) { if (g.Revision >= 100) throw new CommunityFailure(409, "This gathering has reached its revision limit."); Archive(g); g.Revision++; foreach (var i in g.Invites) i.State = "Pending"; }
            Apply(g, r, start); g.Version++; Command(g, user, r.ClientRequestId, hash); Changed(g, user, material ? "reconfirmation" : "updated", removed); await db.SaveChangesAsync(ct);
        }
        var result = await Dto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    private async Task AddComment(Gathering g, Guid user, string text, CancellationToken ct)
    {
        Text(text, 2000); if (string.IsNullOrWhiteSpace(text)) throw new CommunityFailure(422, "Enter a nonempty clarification or discussion comment.");
        if (await db.GatheringComments.CountAsync(c => c.GatheringId == g.Id, ct) >= 200) throw new CommunityFailure(409, "This gathering has reached its discussion limit.");
        db.GatheringComments.Add(new() { Id = Guid.NewGuid(), GatheringId = g.Id, AuthorId = user, Text = text.Trim(), Revision = g.Revision, Sequence = g.Version + 1, CreatedAt = clock.GetUtcNow() });
    }
    public async Task<GatheringDto> Respond(Guid community, Guid id, Guid user, GatheringResponseRequest r, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct); var hash = Hash(new { response = id, r });
        var invite = g.Invites.SingleOrDefault(i => i.UserId == user && i.Active) ?? throw new CommunityFailure(403, "Only an invited participant can respond for their own account.");
        if (await Prior(community, user, r.ClientRequestId, hash, ct) is null)
        {
            Scheduled(g); if (r.ExpectedRevision != g.Revision) throw new CommunityFailure(409, "The plan changed. Review the current revision before responding.");
            if (r.State is not ("Accepted" or "Declined" or "NeedsClarification")) throw new CommunityFailure(422, "Choose accept, decline or clarification.");
            if (r.State == "NeedsClarification") await AddComment(g, user, r.Comment, ct);
            else if (!string.IsNullOrEmpty(r.Comment)) throw new CommunityFailure(422, "Use the discussion action for a follow-up comment.");
            invite.State = r.State; g.Version++; Command(g, user, r.ClientRequestId, hash); Changed(g, user, "response"); await db.SaveChangesAsync(ct);
        }
        var result = await Dto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<GatheringDto> Discuss(Guid community, Guid id, Guid user, GatheringCommentRequest r, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct); var hash = Hash(new { discussion = id, r });
        if (await Prior(community, user, r.ClientRequestId, hash, ct) is null)
        {
            Scheduled(g); if (r.ExpectedRevision != g.Revision) throw new CommunityFailure(409, "The plan changed. Review the current revision before responding.");
            await AddComment(g, user, r.Text, ct); g.Version++; Command(g, user, r.ClientRequestId, hash); Changed(g, user, "comment"); await db.SaveChangesAsync(ct);
        }
        var result = await Dto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<GatheringDto> Status(Guid community, Guid id, Guid user, GatheringStatusRequest r, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct, true); var hash = Hash(new { status = id, r });
        if (await Prior(community, user, r.ClientRequestId, hash, ct) is null)
        {
            Version(g, r.ExpectedVersion);
            if (r.Status is not ("Cancelled" or "Completed")) throw new CommunityFailure(422, "Choose cancel or complete.");
            if (g.Status != r.Status) { Scheduled(g); if (r.Status == "Completed" && g.StartAt > clock.GetUtcNow()) throw new CommunityFailure(422, "Complete a gathering only after its scheduled start."); g.Status = r.Status; g.Version++; Changed(g, user, r.Status == "Cancelled" ? "cancelled" : "completed"); }
            Command(g, user, r.ClientRequestId, hash); await db.SaveChangesAsync(ct);
        }
        var result = await Dto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<GatheringRevisionDto[]> Revisions(Guid community, Guid id, Guid user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Authorized(community, id, user, ct);
        var result = await db.GatheringRevisions.AsNoTracking().Where(r => r.GatheringId == id).OrderBy(r => r.Revision).Select(r => new GatheringRevisionDto(r.Revision, r.PlanJson, r.ResponsesJson)).ToArrayAsync(ct);
        await tx.CommitAsync(ct); return result;
    }
    public async Task<GatheringNotices> Notices(Guid community, Guid user, int offset, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockCommunity(community, user, ct);
        var allowed = db.Gatherings.Where(g => g.CommunityId == community && (g.OrganizerId == user || g.Invites.Any(i => i.UserId == user && i.Active))).Select(g => g.Id);
        if (offset is < 0 or > 100000) throw new CommunityFailure(422, "Use a valid list position.");
        var result = await db.GatheringNotices.AsNoTracking().Where(n => n.UserId == user && allowed.Contains(n.GatheringId)).OrderByDescending(n => n.CreatedAt).ThenBy(n => n.Id).Skip(offset).Take(101)
            .Select(n => new GatheringNoticeDto(n.Id.ToString(), n.GatheringId.ToString(), n.Kind, n.Revision, n.Version.ToString(), n.CreatedAt, n.Seen)).ToArrayAsync(ct);
        await tx.CommitAsync(ct); return new(result.Take(100).ToArray(), result.Length > 100, offset + Math.Min(result.Length, 100));
    }
    public async Task Seen(Guid community, Guid id, Guid user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockCommunity(community, user, ct);
        var notice = await db.GatheringNotices.SingleOrDefaultAsync(n => n.Id == id && n.UserId == user, ct) ?? throw new CommunityFailure(404, "Notification is unavailable.");
        await Authorized(community, notice.GatheringId, user, ct); notice.Seen = true; await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
}
