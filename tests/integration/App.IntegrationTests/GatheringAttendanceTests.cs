using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Gatherings;
namespace App.IntegrationTests;
public sealed partial class GatheringTests
{
    [Fact]
    public async Task ApplyingTheCurrentGameClosesThePollWithoutFalseReconfirmation()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var member = host.CreateClient(); await Register(owner); var pm = await Register(member); var c = await CreateCommunity(owner); await Join(owner, member, c);
        var g = await Result(await Command(owner, Root(c), Plan(pm))); var path = Root(c) + "/" + g.Id;
        g = await Result(await Command(member, path + "/response", new GatheringResponseRequest(Guid.NewGuid(), 1, "Accepted"), "PUT"));
        await Prepared(await Command(member, path + "/reminder", new ReminderRequest(Guid.NewGuid(), 1, "0", 15), "PUT"));
        var choices = await Chosen(await Command(owner, path + "/polls", new PollCreateRequest(Guid.NewGuid(), g.Version, "Game", [new("Chess"), new("Go")]))); var p = choices.Polls.Single();
        choices = await Chosen(await Command(owner, path + $"/polls/{p.Id}/decision", new PollDecisionRequest(Guid.NewGuid(), choices.Gathering.Version, "apply", Guid.Parse(p.Options[0].Id)), "PUT"));
        Assert.Equal(1, choices.Gathering.Revision); Assert.Equal("Accepted", choices.Gathering.Invites.Single().State); Assert.Equal("Confirmed", choices.Gathering.Invites.Single().Place);
        Assert.Equal(15, (await member.GetFromJsonAsync<GatheringPreparationDto>(path + "/preparation"))!.Reminder.Minutes);
        Assert.DoesNotContain((await member.GetFromJsonAsync<GatheringNotices>(Root(c) + "/notices"))!.Items, n => n.Kind == "reconfirmation");
    }
    private static async Task<GatheringChoicesDto> Chosen(HttpResponseMessage r)
    { using (r) { Assert.True(r.StatusCode == HttpStatusCode.OK, await r.Content.ReadAsStringAsync()); return (await r.Content.ReadFromJsonAsync<GatheringChoicesDto>())!; } }
    [Fact]
    public async Task LastSeatReserveAndManualPromotionStaySafeUnderConcurrentCommands()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var a = host.CreateClient(); using var b = host.CreateClient(); using var other = host.CreateClient();
        await Register(owner); var pa = await Register(a); var pb = await Register(b); await Register(other); var c = await CreateCommunity(owner);
        foreach (var user in new[] { a, b, other }) await Join(owner, user, c);
        var g = await Result(await Command(owner, Root(c), Plan(pa, pb))); var path = Root(c) + "/" + g.Id;
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(a, path + "/capacity", new CapacityRequest(Guid.NewGuid(), g.Version, 2), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(path + "/choices")).StatusCode);
        var cap = new CapacityRequest(Guid.NewGuid(), g.Version, 2); g = await Result(await Command(owner, path + "/capacity", cap, "PUT"));
        await Task.WhenAll(Command(a, path + "/response", new GatheringResponseRequest(Guid.NewGuid(), 1, "Accepted"), "PUT"), Command(b, path + "/response", new GatheringResponseRequest(Guid.NewGuid(), 1, "Accepted"), "PUT"));
        g = (await owner.GetFromJsonAsync<GatheringDto>(path))!; Assert.Single(g.Invites, i => i.Place == "Confirmed"); Assert.Single(g.Invites, i => i.Place == "Reserve");
        var winner = g.Invites.Single(i => i.Place == "Confirmed"); var reserve = g.Invites.Single(i => i.Place == "Reserve"); var winningClient = winner.UserId == pa.Id ? a : b; var reserveClient = reserve.UserId == pa.Id ? a : b;
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner, path + "/capacity", new CapacityRequest(Guid.NewGuid(), g.Version, 1), "PUT")).StatusCode);
        g = await Result(await Command(winningClient, path + "/response", new GatheringResponseRequest(Guid.NewGuid(), 1, "Declined"), "PUT"));
        g = await Result(await Command(reserveClient, path + "/response", new GatheringResponseRequest(Guid.NewGuid(), 1, "Accepted"), "PUT")); Assert.Equal("Reserve", g.Invites.Single(i => i.UserId == reserve.UserId).Place);
        var seat = new SeatRequest(Guid.NewGuid(), g.Version, Guid.Parse(reserve.UserId), true); g = await Result(await Command(owner, path + "/seat", seat, "PUT")); Assert.Equal("Confirmed", g.Invites.Single(i => i.UserId == reserve.UserId).Place);
        g = await Result(await Command(owner, path + "/seat", seat, "PUT")); Assert.Single(g.Invites, i => i.Place == "Confirmed");
        await Command(reserveClient, $"/api/v1/communities/{c.Id}/leave", new { }); await Join(owner, reserveClient, c); Assert.Equal(HttpStatusCode.NotFound, (await reserveClient.GetAsync(path)).StatusCode);
        g = (await owner.GetFromJsonAsync<GatheringDto>(path))!; Assert.DoesNotContain(g.Invites, i => i.UserId == reserve.UserId);
        g = await Result(await Command(owner, path + "/capacity", cap, "PUT")); Assert.Equal(2, g.Capacity); // Replay returns current state.
    }
    [Fact]
    public async Task PollsKeepVotesPrivateToEligibleViewersAndOnlyExplicitDecisionsChangePlans()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var member = host.CreateClient(); using var other = host.CreateClient();
        await Register(owner); var pm = await Register(member); await Register(other); var c = await CreateCommunity(owner); await Join(owner, member, c); await Join(owner, other, c);
        var plan = Plan(pm); var g = await Result(await Command(owner, Root(c), plan)); var path = Root(c) + "/" + g.Id;
        var create = new PollCreateRequest(Guid.NewGuid(), g.Version, "Game", [new("Chess"), new("Checkers")]);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(member, path + "/polls", create)).StatusCode);
        var choices = await Chosen(await Command(owner, path + "/polls", create)); Assert.Single(choices.Polls);
        Assert.Single((await Chosen(await Command(owner, path + "/polls", create))).Polls);
        var poll = choices.Polls.Single(); var vote = new PollVoteRequest(Guid.NewGuid(), 1, "0", [Guid.Parse(poll.Options[1].Id)]);
        choices = await Chosen(await Command(member, path + $"/polls/{poll.Id}/vote", vote, "PUT")); Assert.Equal("Chess", choices.Gathering.Game); Assert.Equal(1, choices.Polls.Single().Options[1].Votes);
        var forOwner = (await owner.GetFromJsonAsync<GatheringChoicesDto>(path + "/choices"))!; Assert.Empty(forOwner.Polls.Single().MyOptions);
        choices = await Chosen(await Command(member, path + $"/polls/{poll.Id}/vote", vote, "PUT")); Assert.Equal(1, choices.Polls.Single().Options[1].Votes);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member, path + $"/polls/{poll.Id}/vote", vote with { Options = [] }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(other, path + $"/polls/{poll.Id}/vote", vote, "PUT")).StatusCode);
        var currentVote = choices.Polls.Single(); Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(member, path + $"/polls/{poll.Id}/vote", new PollVoteRequest(Guid.NewGuid(), 1, currentVote.VoteVersion, [Guid.NewGuid()]), "PUT")).StatusCode);
        var prep = await Prepared(await Command(member, path + "/reminder", new ReminderRequest(Guid.NewGuid(), 1, "0", 15), "PUT"));
        var apply = new PollDecisionRequest(Guid.NewGuid(), choices.Gathering.Version, "apply", Guid.Parse(poll.Options[1].Id));
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(member, path + $"/polls/{poll.Id}/decision", apply, "PUT")).StatusCode);
        choices = await Chosen(await Command(owner, path + $"/polls/{poll.Id}/decision", apply, "PUT")); Assert.Equal("Checkers", choices.Gathering.Game); Assert.Equal(2, choices.Gathering.Revision); Assert.True(choices.Polls.Single().Closed);
        Assert.Equal("Pending", choices.Gathering.Invites.Single().State); Assert.Equal("None", choices.Gathering.Invites.Single().Place);
        Assert.Null((await member.GetFromJsonAsync<GatheringPreparationDto>(path + "/preparation"))!.Reminder.Minutes);
        choices = await Chosen(await Command(owner, path + $"/polls/{poll.Id}/decision", apply, "PUT")); Assert.Equal(2, choices.Gathering.Revision);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member, path + $"/polls/{poll.Id}/vote", new PollVoteRequest(Guid.NewGuid(), 2, currentVote.VoteVersion, []), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync("/health/ready")).StatusCode);
    }
    [Fact]
    public async Task TimePollsResolveExplicitZonesRejectAmbiguityAndRetireVotesOnReinvitation()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var member = host.CreateClient(); await Register(owner); var pm = await Register(member); var c = await CreateCommunity(owner); await Join(owner, member, c);
        var plan = Plan(pm); var g = await Result(await Command(owner, Root(c), plan)); var path = Root(c) + "/" + g.Id;
        var bad = new PollCreateRequest(Guid.NewGuid(), g.Version, "Time", [new("", "2027-03-28T02:30", "Europe/Berlin"), new("", "2027-03-28T04:30", "Europe/Berlin")]);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(owner, path + "/polls", bad)).StatusCode);
        var time = DateTime.UtcNow.AddDays(3).ToString("yyyy-MM-dd'T'HH:mm");
        var options = new[] { new PollOptionInput("", time, "UTC"), new PollOptionInput("", DateTime.UtcNow.AddDays(4).ToString("yyyy-MM-dd'T'HH:mm"), "UTC") };
        var choices = await Chosen(await Command(owner, path + "/polls", new PollCreateRequest(Guid.NewGuid(), g.Version, "Time", options))); var p = choices.Polls.Single();
        var vote = new PollVoteRequest(Guid.NewGuid(), 1, "0", p.Options.Select(o => Guid.Parse(o.Id)).ToArray());
        await Chosen(await Command(member, path + $"/polls/{p.Id}/vote", vote, "PUT"));
        await Command(member, $"/api/v1/communities/{c.Id}/leave", new { }); await Join(owner, member, c); g = (await owner.GetFromJsonAsync<GatheringDto>(path))!;
        g = await Result(await Command(owner, path, plan with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = g.Version }, "PUT"));
        choices = (await member.GetFromJsonAsync<GatheringChoicesDto>(path + "/choices"))!; Assert.Empty(choices.Polls.Single().MyOptions); Assert.All(choices.Polls.Single().Options, o => Assert.Equal(0, o.Votes));
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member, path + $"/polls/{p.Id}/vote", vote with { ClientRequestId = Guid.NewGuid() }, "PUT")).StatusCode);
        choices = await Chosen(await Command(owner, path + $"/polls/{p.Id}/decision", new PollDecisionRequest(Guid.NewGuid(), choices.Gathering.Version, "apply", Guid.Parse(p.Options[0].Id)), "PUT")); Assert.Equal(time, choices.Gathering.LocalStart); Assert.Equal("UTC", choices.Gathering.TimeZoneId);
        Assert.Equal(GatheringService.ResolveTime(time, "UTC"), choices.Gathering.StartAt);
    }
}
