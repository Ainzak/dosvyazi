using System.Globalization;
using App.Api.Features.Communities;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Gatherings;

public sealed partial class GatheringService
{
    private static bool Participates(Gathering g, Guid user) => g.OrganizerId == user || g.Invites.Any(i => i.UserId == user && i.Active);
    private async Task<GatheringPreparationDto> PreparationDto(Gathering g, Guid user, CancellationToken ct)
    {
        var items = await db.GatheringChecklistItems.AsNoTracking().Where(i => i.GatheringId == g.Id && !i.Removed)
            .OrderBy(i => i.CreatedAt).ThenBy(i => i.Id).Select(i => new ChecklistItemDto(i.Id.ToString(), i.Text, i.AssigneeId == null ? null : i.AssigneeId.ToString(), i.Done)).ToArrayAsync(ct);
        var reminder = await db.GatheringReminders.AsNoTracking().SingleOrDefaultAsync(r => r.GatheringId == g.Id && r.UserId == user, ct);
        return new(g.Version.ToString(CultureInfo.InvariantCulture), items,
            reminder is null ? new("0", g.Revision, null, null, null) : new(reminder.Version.ToString(CultureInfo.InvariantCulture), reminder.Revision, reminder.Minutes, reminder.DueAt, reminder.DeliveredAt),
            Participates(g, user) && g.Status == "Scheduled" && g.StartAt > clock.GetUtcNow());
    }
    public async Task<GatheringPreparationDto> Preparation(Guid community, Guid id, Guid user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct);
        var result = await PreparationDto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<GatheringPreparationDto> Checklist(Guid community, Guid id, Guid item, Guid user, ChecklistRequest r, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct);
        var manage = await CanManage(g, user, ct);
        if (r.Action is not ("save" or "complete" or "remove") || item == Guid.Empty) throw new CommunityFailure(422, "Choose a valid checklist action and item.");
        if (r.Action != "complete" && !manage) throw new CommunityFailure(403, "Only the organizer or a community moderator can edit the checklist.");
        var hash = Hash(new { checklist = id, item, r });
        var prior = await Prior(community, user, r.ClientRequestId, hash, ct);
        var row = await db.GatheringChecklistItems.SingleOrDefaultAsync(i => i.Id == item && i.GatheringId == id, ct);
        if (r.Action == "complete" && !manage && (row is null || row.AssigneeId != user)) throw new CommunityFailure(403, "Only the assigned participant or organizer can change readiness.");
        if (prior is null)
        {
            Scheduled(g); Version(g, r.ExpectedVersion);
            if (r.Action == "save")
            {
                Text(r.Text, 160); if (string.IsNullOrWhiteSpace(r.Text)) throw new CommunityFailure(422, "Enter a checklist item.");
                if (r.AssigneeId is Guid assignee && (!Participates(g, assignee) || !await db.Memberships.AnyAsync(m => m.CommunityId == community && m.UserId == assignee && m.Status == "Active", ct)))
                    throw new CommunityFailure(422, "Assign a current organizer or invited participant.");
                if (row is null)
                {
                    if (await db.GatheringChecklistItems.AnyAsync(i => i.Id == item, ct)) throw new CommunityFailure(409, "Choose a new checklist item ID.");
                    if (await db.GatheringChecklistItems.CountAsync(i => i.GatheringId == id && !i.Removed, ct) >= 30 || await db.GatheringChecklistItems.CountAsync(i => i.GatheringId == id, ct) >= 300)
                        throw new CommunityFailure(409, "This gathering has reached its checklist limit.");
                    row = new() { Id = item, GatheringId = id, CreatedAt = clock.GetUtcNow() }; db.GatheringChecklistItems.Add(row);
                }
                if (row.Removed) throw new CommunityFailure(409, "This checklist item was removed. Add a new item instead.");
                if (row.Text != r.Text.Trim() || row.AssigneeId != r.AssigneeId) row.Done = false;
                row.Text = r.Text.Trim(); row.AssigneeId = r.AssigneeId;
            }
            else
            {
                if (row is null || row.Removed) throw new CommunityFailure(404, "Checklist item is unavailable.");
                if (r.Action == "remove") { row.Removed = true; row.Done = false; } else row.Done = r.Done;
            }
            g.Version++; Command(g, user, r.ClientRequestId, hash);
            // A checkbox refreshes the shared view without notifying every participant.
            db.GatheringEvents.Add(new() { Id = Guid.NewGuid(), CommunityId = community, GatheringId = id, Version = g.Version });
            CommunityAudit.Add(db, community, user, "gathering.checklist", g.Id);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException e) when (e.InnerException is Npgsql.PostgresException { SqlState: "23505", ConstraintName: "PK_GatheringChecklistItems" })
            { throw new CommunityFailure(409, "Choose a new checklist item ID."); }
        }
        var result = await PreparationDto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<GatheringPreparationDto> Reminder(Guid community, Guid id, Guid user, ReminderRequest r, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct);
        if (!Participates(g, user)) throw new CommunityFailure(403, "Only an organizer or invited participant can set a personal reminder.");
        var hash = Hash(new { reminder = id, r });
        if (await Prior(community, user, r.ClientRequestId, hash, ct) is null)
        {
            var row = await db.GatheringReminders.SingleOrDefaultAsync(x => x.GatheringId == id && x.UserId == user, ct);
            if (r.ExpectedVersion != (row?.Version ?? 0).ToString(CultureInfo.InvariantCulture)) throw new CommunityFailure(409, "Your reminder changed. Review it before saving again.");
            if (r.ExpectedRevision != g.Revision) throw new CommunityFailure(409, "The plan changed. Review the current revision before responding.");
            if (r.Minutes is not (null or 5 or 15 or 60 or 1440)) throw new CommunityFailure(422, "Choose a supported reminder time.");
            if (r.Minutes is not null) { Scheduled(g); if (g.StartAt <= clock.GetUtcNow()) throw new CommunityFailure(422, "Reminders are available only before the gathering starts."); }
            if (row is null) { row = new() { GatheringId = id, UserId = user }; db.GatheringReminders.Add(row); }
            await ClearReminder(row, ct); row.Revision = g.Revision; row.Minutes = r.Minutes;
            row.DueAt = r.Minutes is int minutes ? g.StartAt.AddMinutes(-minutes) : null;
            Command(g, user, r.ClientRequestId, hash); await db.SaveChangesAsync(ct);
        }
        var result = await PreparationDto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    private async Task ClearReminder(GatheringReminder row, CancellationToken ct)
    {
        if (row.NoticeId is Guid notice) await db.GatheringNotices.Where(n => n.Id == notice).ExecuteDeleteAsync(ct);
        row.Minutes = null; row.DueAt = null; row.DeliveredAt = null; row.NoticeId = null; row.Version++;
    }
    // Called only under the community writer lock, also by membership retirement.
    private async Task ResetPreparation(Gathering g, Guid[] removed, bool planChanged, bool closed, CancellationToken ct)
    {
        foreach (var row in await db.GatheringChecklistItems.Where(i => i.GatheringId == g.Id && !i.Removed).ToArrayAsync(ct))
        {
            if (row.AssigneeId is Guid user && removed.Contains(user)) { row.AssigneeId = null; row.Done = false; }
            if (planChanged) row.Done = false;
        }
        foreach (var row in await db.GatheringReminders.Where(r => r.GatheringId == g.Id && (planChanged || closed || removed.Contains(r.UserId))).ToArrayAsync(ct)) await ClearReminder(row, ct);
    }
    public async Task DeliverReminders(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var due = await db.GatheringReminders.AsNoTracking().Where(r => r.DueAt != null && r.DueAt <= now)
            .OrderBy(r => r.DueAt).ThenBy(r => r.GatheringId).Select(r => new { r.GatheringId, r.UserId }).Take(100).ToArrayAsync(ct);
        foreach (var candidate in due)
        {
            db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(ct);
            var community = await db.Gatherings.Where(g => g.Id == candidate.GatheringId).Select(g => g.CommunityId).SingleAsync(ct);
            await db.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(ct);
            var g = await db.Gatherings.Include(g => g.Invites).SingleAsync(g => g.Id == candidate.GatheringId, ct);
            var row = await db.GatheringReminders.SingleAsync(r => r.GatheringId == g.Id && r.UserId == candidate.UserId, ct);
            if (row.DueAt is null || row.DueAt > clock.GetUtcNow()) { await tx.CommitAsync(ct); continue; }
            now = clock.GetUtcNow();
            if (g.Status != "Scheduled" || g.Revision != row.Revision || g.StartAt <= now || !Participates(g, row.UserId) ||
                !await db.Memberships.AnyAsync(m => m.CommunityId == community && m.UserId == row.UserId && m.Status == "Active", ct)) await ClearReminder(row, ct);
            else
            {
                var notice = Guid.NewGuid(); row.NoticeId = notice; row.DeliveredAt = now; row.DueAt = null;
                db.GatheringNotices.Add(new() { Id = notice, GatheringId = g.Id, UserId = row.UserId, Kind = "reminder", Revision = g.Revision, Version = g.Version, CreatedAt = now });
                db.GatheringEvents.Add(new() { Id = Guid.NewGuid(), CommunityId = community, GatheringId = g.Id, Version = g.Version });
            }
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        }
    }
    public async Task<string> Calendar(Guid community, Guid id, Guid user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct);
        var result = GatheringCalendar.Export(g, clock.GetUtcNow()); await tx.CommitAsync(ct); return result;
    }
}
