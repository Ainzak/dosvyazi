using System.Globalization;
using App.Api.Features.Communities;
using Microsoft.EntityFrameworkCore;
namespace App.Api.Features.Gatherings;
public sealed partial class GatheringService
{
    public async Task<GatheringDto> Capacity(Guid community, Guid id, Guid user, CapacityRequest r, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct, true); var hash = Hash(new { capacity = id, r });
        if (await Prior(community, user, r.ClientRequestId, hash, ct) is null)
        {
            Scheduled(g); Version(g, r.ExpectedVersion);
            if (r.Capacity is not null && (r.Capacity is < 1 or > 51 || r.Capacity < 1 + g.Invites.Count(i => i.Active && i.State == "Accepted" && i.HasSeat)))
                throw new CommunityFailure(409, "Choose 1–51 places including the organizer. Move confirmed participants to reserve before reducing the limit.");
            g.Capacity = r.Capacity; g.Version++; Command(g, user, r.ClientRequestId, hash); Changed(g, user, "capacity"); await db.SaveChangesAsync(ct);
        }
        var result = await Dto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<GatheringDto> Seat(Guid community, Guid id, Guid user, SeatRequest r, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct, true); var hash = Hash(new { seat = id, r });
        if (await Prior(community, user, r.ClientRequestId, hash, ct) is null)
        {
            Scheduled(g); Version(g, r.ExpectedVersion);
            var invite = g.Invites.SingleOrDefault(i => i.UserId == r.UserId && i.Active && i.State == "Accepted") ?? throw new CommunityFailure(422, "Choose an accepted participant before assigning a place.");
            if (r.Confirmed && !invite.HasSeat && g.Capacity is int cap && 1 + g.Invites.Count(i => i.Active && i.State == "Accepted" && i.HasSeat) >= cap)
                throw new CommunityFailure(409, "There are no free places. Change the limit or move someone to reserve first.");
            invite.HasSeat = r.Confirmed; g.Version++; Command(g, user, r.ClientRequestId, hash); Changed(g, user, "place"); await db.SaveChangesAsync(ct);
        }
        var result = await Dto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    private async Task ResetAttendance(Gathering g, Guid[] removed, bool material, bool closed, CancellationToken ct)
    {
        foreach (var invite in g.Invites.Where(i => removed.Contains(i.UserId))) invite.HasSeat = false;
        var polls = await db.GatheringPolls.Where(p => p.GatheringId == g.Id).ToArrayAsync(ct);
        if (material || closed) foreach (var p in polls) p.Closed = true;
        var ids = polls.Select(p => p.Id).ToArray();
        foreach (var vote in await db.GatheringPollVotes.Where(v => ids.Contains(v.PollId) && removed.Contains(v.UserId)).ToArrayAsync(ct)) { vote.Options = []; vote.Version++; }
    }
    private async Task<GatheringChoicesDto> ChoicesDto(Gathering g, Guid user, CancellationToken ct)
    {
        var polls = await db.GatheringPolls.Include(p => p.Options).Where(p => p.GatheringId == g.Id).OrderBy(p => p.Id).ToArrayAsync(ct);
        var ids = polls.Select(p => p.Id).ToArray();
        var requested = g.Invites.Where(i => i.Active).Select(i => i.UserId).Append(g.OrganizerId).ToArray();
        var eligible = await db.Memberships.Where(m => m.CommunityId == g.CommunityId && m.Status == "Active" && requested.Contains(m.UserId)).Select(m => m.UserId).ToArrayAsync(ct);
        var participants = g.Invites.Where(i => i.Active).Select(i => i.UserId).Append(g.OrganizerId).Intersect(eligible).ToArray();
        var votes = await db.GatheringPollVotes.AsNoTracking().Where(v => ids.Contains(v.PollId) && participants.Contains(v.UserId)).ToArrayAsync(ct);
        return new(await Dto(g, user, ct), polls.Select(p => {
            var own = votes.SingleOrDefault(v => v.PollId == p.Id && v.UserId == user);
            return new GatheringPollDto(p.Id.ToString(), p.Kind, p.Revision, p.Closed, p.SelectedOptionId?.ToString(), (own?.Version ?? 0).ToString(CultureInfo.InvariantCulture),
                own?.Options.Select(x => x.ToString()).ToArray() ?? [], p.Options.OrderBy(o => o.Position).Select(o => new PollOptionDto(o.Id.ToString(), o.Game, o.LocalStart, o.TimeZoneId, o.StartAt, votes.Count(v => v.PollId == p.Id && v.Options.Contains(o.Id)))).ToArray());
        }).ToArray());
    }
    public async Task<GatheringChoicesDto> Choices(Guid community, Guid id, Guid user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct);
        var result = await ChoicesDto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<GatheringChoicesDto> CreatePoll(Guid community, Guid id, Guid user, PollCreateRequest r, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct, true); var hash = Hash(new { createPoll = id, r });
        if (await Prior(community, user, r.ClientRequestId, hash, ct) is null)
        {
            Scheduled(g); Version(g, r.ExpectedVersion);
            if (r.Kind is not ("Time" or "Game") || r.Options is null || r.Options.Length is < 2 or > 6 || r.Options.Any(o => o is null)) throw new CommunityFailure(422, "Choose a time or game poll with 2–6 different options.");
            if (await db.GatheringPolls.CountAsync(p => p.GatheringId == id, ct) >= 10) throw new CommunityFailure(409, "This gathering has reached its poll limit.");
            var p = new GatheringPoll { Id = Guid.NewGuid(), GatheringId = id, Kind = r.Kind, Revision = g.Revision };
            for (var n = 0; n < r.Options.Length; n++)
            {
                var o = r.Options[n]; Text(o.Game, 80); Text(o.LocalStart, 16); Text(o.TimeZoneId, 100);
                var start = r.Kind == "Time" ? ResolveTime(o.LocalStart, o.TimeZoneId) : (DateTimeOffset?)null;
                if (r.Kind == "Time" && (start <= clock.GetUtcNow() || o.Game != "") || r.Kind == "Game" && (string.IsNullOrWhiteSpace(o.Game) || o.LocalStart != "")) throw new CommunityFailure(422, "Use nonempty games or future unambiguous times in an explicit zone.");
                p.Options.Add(new() { Id = Guid.NewGuid(), PollId = p.Id, Position = n, Game = r.Kind == "Game" ? o.Game.Trim() : "", LocalStart = r.Kind == "Time" ? o.LocalStart : "", TimeZoneId = r.Kind == "Time" ? o.TimeZoneId : "", StartAt = start });
            }
            if (p.Options.Select(o => r.Kind == "Time" ? o.StartAt!.Value.ToString("O") : o.Game.ToUpperInvariant()).Distinct().Count() != r.Options.Length) throw new CommunityFailure(422, "Choose a time or game poll with 2–6 different options.");
            db.GatheringPolls.Add(p); g.Version++; Command(g, user, r.ClientRequestId, hash); Changed(g, user, "poll"); await db.SaveChangesAsync(ct);
        }
        var result = await ChoicesDto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<GatheringChoicesDto> Vote(Guid community, Guid id, Guid poll, Guid user, PollVoteRequest r, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct);
        if (!Participates(g, user)) throw new CommunityFailure(403, "Only the organizer and invitees can vote.");
        var p = await db.GatheringPolls.Include(p => p.Options).SingleOrDefaultAsync(p => p.Id == poll && p.GatheringId == id, ct) ?? throw new CommunityFailure(404, "Gathering poll is unavailable.");
        var hash = Hash(new { vote = id, poll, r });
        if (await Prior(community, user, r.ClientRequestId, hash, ct) is null)
        {
            Scheduled(g); if (p.Closed || p.Revision != g.Revision || r.ExpectedRevision != g.Revision) throw new CommunityFailure(409, "This poll is closed or its plan changed. Review the current gathering.");
            if (r.Options is null || r.Options.Length > 6 || r.Options.Distinct().Count() != r.Options.Length || r.Options.Any(o => p.Options.All(x => x.Id != o))) throw new CommunityFailure(422, "Select only different options from this poll.");
            var vote = await db.GatheringPollVotes.SingleOrDefaultAsync(v => v.PollId == poll && v.UserId == user, ct);
            if (r.ExpectedVersion != (vote?.Version ?? 0).ToString(CultureInfo.InvariantCulture)) throw new CommunityFailure(409, "Your vote changed. Review it before voting again.");
            if (vote is null) { vote = new() { PollId = poll, UserId = user }; db.GatheringPollVotes.Add(vote); }
            vote.Options = r.Options.Order().ToArray(); vote.Version++; g.Version++; Command(g, user, r.ClientRequestId, hash);
            db.GatheringEvents.Add(new() { Id = Guid.NewGuid(), CommunityId = community, GatheringId = id, Version = g.Version }); await db.SaveChangesAsync(ct);
        }
        var result = await ChoicesDto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    public async Task<GatheringChoicesDto> DecidePoll(Guid community, Guid id, Guid poll, Guid user, PollDecisionRequest r, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct, true); var hash = Hash(new { decidePoll = id, poll, r });
        var p = await db.GatheringPolls.Include(p => p.Options).SingleOrDefaultAsync(p => p.Id == poll && p.GatheringId == id, ct) ?? throw new CommunityFailure(404, "Gathering poll is unavailable.");
        if (await Prior(community, user, r.ClientRequestId, hash, ct) is null)
        {
            Scheduled(g); Version(g, r.ExpectedVersion); if (p.Closed || p.Revision != g.Revision) throw new CommunityFailure(409, "This poll is closed or its plan changed. Review the current gathering.");
            if (r.Action is not ("close" or "apply")) throw new CommunityFailure(422, "Choose close or explicitly apply a poll option.");
            var reconfirm = false;
            if (r.Action == "apply")
            {
                var o = p.Options.SingleOrDefault(o => o.Id == r.OptionId) ?? throw new CommunityFailure(422, "Select an option from this poll.");
                if (o.StartAt <= clock.GetUtcNow()) throw new CommunityFailure(422, "Schedule a changed start in the future.");
                var material = p.Kind == "Time" ? o.StartAt != g.StartAt : o.Game != g.Game;
                if (material)
                {
                    reconfirm = true;
                    if (g.Revision >= 100) throw new CommunityFailure(409, "This gathering has reached its revision limit.");
                    Archive(g); g.Revision++; foreach (var i in g.Invites) { i.State = "Pending"; i.HasSeat = false; }
                    await ResetPreparation(g, [], true, false, ct); await ResetAttendance(g, [], true, false, ct);
                    if (p.Kind == "Time") { g.StartAt = o.StartAt!.Value; g.LocalStart = o.LocalStart; g.TimeZoneId = o.TimeZoneId; } else g.Game = o.Game;
                }
                p.SelectedOptionId = o.Id;
            }
            p.Closed = true; g.Version++; Command(g, user, r.ClientRequestId, hash); Changed(g, user, reconfirm ? "reconfirmation" : "poll"); await db.SaveChangesAsync(ct);
        }
        var result = await ChoicesDto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
}
