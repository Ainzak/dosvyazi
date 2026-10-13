using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.Gatherings;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.SignalR;

namespace App.IntegrationTests;

public sealed class GatheringTimeTests
{
    [Theory]
    [InlineData("2027-03-28T02:30", "Europe/Berlin")]
    [InlineData("2027-10-31T02:30", "Europe/Berlin")]
    [InlineData("2027-02-30T12:00", "UTC")]
    [InlineData("2027-01-01T12:00", "Missing/Zone")]
    public void InvalidOrAmbiguousLocalTimesAreRejected(string local, string zone) => Assert.Throws<CommunityFailure>(() => GatheringService.ResolveTime(local, zone));
    [Fact]
    public void ExplicitZonesResolveToUtc() => Assert.Equal(new DateTimeOffset(2027, 3, 28, 1, 30, 0, TimeSpan.Zero), GatheringService.ResolveTime("2027-03-28T03:30", "Europe/Berlin"));
}

[Trait("Category", "PostgreSQL")]
public sealed class GatheringTests(AccountsDatabase database) : IClassFixture<AccountsDatabase>
{
    private FoundationFactory Factory() => new(connection: database.Connection, permitLimit: 120);
    private static async Task<HttpResponseMessage> Command(HttpClient c, string path, object payload, string method = "POST")
    {
        var csrf = (await c.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!;
        using var request = new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(payload) };
        request.Headers.Add("X-CSRF-TOKEN", csrf.RequestToken); return await c.SendAsync(request);
    }
    private static async Task<UserProfile> Register(HttpClient c)
    {
        using var r = await Command(c, "/api/v1/account/register", new { Email = $"g-{Guid.NewGuid():N}@example.test", Password = "Synthetic gathering passphrase 42", DisplayName = "Gathering member" });
        Assert.Equal(HttpStatusCode.Created, r.StatusCode); return (await r.Content.ReadFromJsonAsync<UserProfile>())!;
    }
    private static async Task<CommunityDetails> CreateCommunity(HttpClient c)
    {
        using var r = await Command(c, "/api/v1/communities", new { ClientRequestId = Guid.NewGuid(), Name = "Gathering crew" });
        Assert.Equal(HttpStatusCode.Created, r.StatusCode); return (await r.Content.ReadFromJsonAsync<CommunityDetails>())!;
    }
    private static async Task Join(HttpClient owner, HttpClient member, CommunityDetails c)
    {
        using var r = await Command(owner, $"/api/v1/communities/{c.Id}/invites", new { ClientRequestId = Guid.NewGuid(), LifetimeHours = 24, MaxUses = 10 });
        var invite = (await r.Content.ReadFromJsonAsync<CreatedInvite>())!;
        Assert.Equal(HttpStatusCode.OK, (await Command(member, "/api/v1/communities/join", new { invite.Code })).StatusCode);
    }
    private static string Root(CommunityDetails c) => $"/api/v1/communities/{c.Id}/gatherings";
    private static GatheringPlanRequest Plan(params UserProfile[] members) => new(Guid.NewGuid(), "0", "Friday team", "Plain description", "Chess", DateTime.UtcNow.AddDays(2).ToString("yyyy-MM-dd'T'HH:mm"), "UTC", members.Select(m => Guid.Parse(m.Id)).ToArray());
    private static async Task<GatheringDto> Result(HttpResponseMessage r)
    {
        using (r) { Assert.True(r.StatusCode == HttpStatusCode.OK, await r.Content.ReadAsStringAsync()); return (await r.Content.ReadFromJsonAsync<GatheringDto>())!; }
    }
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }
    [Fact]
    public async Task CompletionAndModeratorAccessDoNotGrantPrivateChannelPermissions()
    {
        var clock = new Clock(); await using var baseHost = Factory();
        await using var host = baseHost.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddSingleton<TimeProvider>(clock)));
        using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); var p = await Register(member); var c = await CreateCommunity(owner); await Join(owner, member, c);
        var policy = (await owner.GetFromJsonAsync<AccessPolicy>($"/api/v1/communities/{c.Id}/access"))!;
        var noView = policy with { Roles = policy.Roles.Select(r => r with { Grants = 0 }).ToArray() };
        Assert.Equal(HttpStatusCode.OK, (await Command(owner, $"/api/v1/communities/{c.Id}/access", new SaveAccessRequest(Guid.NewGuid(), noView), "PUT")).StatusCode);
        var g = await Result(await Command(owner, Root(c), Plan(p) with { LocalStart = clock.Now.AddMinutes(3).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm") })); var path = Root(c) + "/" + g.Id;
        Assert.Equal(HttpStatusCode.OK, (await member.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.GetAsync($"/api/v1/communities/{c.Id}/channels/{c.Channels[0].Id}/messages")).StatusCode);
        clock.Now = g.StartAt.AddMinutes(1);
        g = await Result(await Command(owner, path + "/status", new GatheringStatusRequest(Guid.NewGuid(), g.Version, "Completed"), "PUT"));
        Assert.Equal("Completed", g.Status);
        policy = (await owner.GetFromJsonAsync<AccessPolicy>($"/api/v1/communities/{c.Id}/access"))!;
        Assert.Equal(HttpStatusCode.OK, (await Command(owner, $"/api/v1/communities/{c.Id}/access", new SaveAccessRequest(Guid.NewGuid(), policy with { Roles = policy.Roles.Select(r => r with { Grants = ChannelAccess.ManageRoles }).ToArray() }), "PUT")).StatusCode);
        Assert.True((await member.GetFromJsonAsync<GatheringDto>(path))!.CanManage);
        Assert.Equal(HttpStatusCode.NotFound, (await member.GetAsync($"/api/v1/communities/{c.Id}/channels/{c.Channels[0].Id}/messages")).StatusCode);
    }
    private sealed class RecordingClients : IHubClients, IClientProxy
    {
        public List<string> Targets { get; } = []; public bool Fail; private string target = "";
        public Task SendCoreAsync(string method, object?[] args, CancellationToken ct = default)
        {
            if (Fail) throw new IOException("Synthetic publication failure");
            Assert.Equal("GatheringsRefresh", method);
            var json = System.Text.Json.JsonSerializer.Serialize(args.Single());
            Assert.DoesNotContain("gatheringId", json); Assert.DoesNotContain("title", json); Assert.Contains("communityId", json);
            Targets.Add(target); return Task.CompletedTask;
        }
        public IClientProxy Client(string id) { target = id; return this; }
        public IClientProxy All => throw new NotSupportedException();
        public IClientProxy AllExcept(IReadOnlyList<string> ids) => throw new NotSupportedException();
        public IClientProxy Clients(IReadOnlyList<string> ids) => throw new NotSupportedException();
        public IClientProxy Group(string id) => throw new NotSupportedException();
        public IClientProxy GroupExcept(string id, IReadOnlyList<string> ids) => throw new NotSupportedException();
        public IClientProxy Groups(IReadOnlyList<string> ids) => throw new NotSupportedException();
        public IClientProxy User(string id) => throw new NotSupportedException();
        public IClientProxy Users(IReadOnlyList<string> ids) => throw new NotSupportedException();
    }
    private sealed class Hub(RecordingClients clients) : IHubContext<GatheringsHub>
    {
        public IHubClients Clients => clients;
        public IGroupManager Groups => throw new NotSupportedException();
    }
    [Fact]
    public async Task DurablePublicationRetriesAndRechecksCurrentRecipientsAndSessions()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var invited = host.CreateClient(); using var other = host.CreateClient();
        var po = await Register(owner); var pi = await Register(invited); var pu = await Register(other);
        var c = await CreateCommunity(owner); await Join(owner, invited, c); await Join(owner, other, c);
        var g = await Result(await Command(owner, Root(c), Plan(pi))); var path = Root(c) + "/" + g.Id;
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var connections = new GatheringConnections(); var aborted = new List<string>();
        foreach (var p in new[] { po, pi, pu })
        {
            var id = Guid.Parse(p.Id); var session = await db.Sessions.Include(s => s.User).SingleAsync(s => s.UserId == id);
            Assert.True(connections.Add(new(p.Id, id, session.Id, session.User.SecurityStamp!, Guid.Parse(c.Id), () => aborted.Add(p.Id))));
        }
        var clients = new RecordingClients { Fail = true }; var publisher = new GatheringPublisher(db, connections, new Hub(clients));
        var entry = await db.GatheringEvents.SingleAsync(e => e.GatheringId == Guid.Parse(g.Id));
        await Assert.ThrowsAsync<IOException>(() => publisher.Publish(entry.Id, CancellationToken.None));
        db.ChangeTracker.Clear(); Assert.Null((await db.GatheringEvents.SingleAsync(e => e.Id == entry.Id)).PublishedAt);
        clients.Fail = false; await publisher.Publish(entry.Id, CancellationToken.None); Assert.Contains(po.Id, clients.Targets); Assert.Contains(pi.Id, clients.Targets); Assert.DoesNotContain(pu.Id, clients.Targets);
        g = await Result(await Command(owner, path, Plan(pu) with { ExpectedVersion = g.Version }, "PUT"));
        db.ChangeTracker.Clear(); clients.Targets.Clear(); var removal = await db.GatheringEvents.SingleAsync(e => e.GatheringId == Guid.Parse(g.Id) && e.PublishedAt == null);
        await publisher.Publish(removal.Id, CancellationToken.None); Assert.Contains(pi.Id, clients.Targets); // Generic invalidation only.
        Assert.Equal(HttpStatusCode.NotFound, (await invited.GetAsync(path)).StatusCode);
        var revoked = await db.Sessions.SingleAsync(s => s.UserId == Guid.Parse(pi.Id)); revoked.RevokedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync();
        await publisher.Reconcile(CancellationToken.None); Assert.Contains(pi.Id, aborted); Assert.DoesNotContain(connections.All(), connection => connection.User == Guid.Parse(pi.Id));
    }
    [Fact]
    public async Task DecisionsDiscussionRevisionsAndPayloadBoundRetriesRemainConsistent()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var a = host.CreateClient(); using var b = host.CreateClient(); using var d = host.CreateClient();
        await Register(owner); var pa = await Register(a); var pb = await Register(b); var pd = await Register(d); var c = await CreateCommunity(owner);
        await Join(owner, a, c); await Join(owner, b, c); await Join(owner, d, c); var plan = Plan(pa, pb, pd);
        var concurrent = await Task.WhenAll(Command(owner, Root(c), plan), Command(owner, Root(c), plan));
        var g = await Result(concurrent[0]); Assert.Equal(g.Id, (await Result(concurrent[1])).Id); var path = Root(c) + "/" + g.Id;
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner, Root(c), plan with { Title = "Different payload" })).StatusCode);
        g = await Result(await Command(a, path + "/response", new GatheringResponseRequest(Guid.NewGuid(), 1, "Accepted"), "PUT"));
        g = await Result(await Command(b, path + "/response", new GatheringResponseRequest(Guid.NewGuid(), 1, "Declined"), "PUT"));
        var clarify = new GatheringResponseRequest(Guid.NewGuid(), 1, "NeedsClarification", "Can we start later?");
        g = await Result(await Command(d, path + "/response", clarify, "PUT"));
        Assert.Equal(1, g.Invites.Count(i => i.State == "Accepted")); Assert.Equal(1, g.Invites.Count(i => i.State == "Declined")); Assert.Equal(1, g.Invites.Count(i => i.State == "NeedsClarification"));
        var reply = new GatheringCommentRequest(Guid.NewGuid(), 1, "I will check the schedule.");
        g = await Result(await Command(owner, path + "/comments", reply)); var version = g.Version;
        g = await Result(await Command(owner, path + "/comments", reply)); Assert.Equal(version, g.Version); Assert.Equal(2, g.Comments.Length);
        Assert.Equal("NeedsClarification", g.Invites.Single(i => i.UserId == pd.Id).State);
        g = await Result(await Command(owner, path, plan with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = g.Version, Title = "New title" }, "PUT"));
        Assert.Equal(1, g.Revision); Assert.Equal("Accepted", g.Invites.Single(i => i.UserId == pa.Id).State);
        var stale = g.Version;
        g = await Result(await Command(owner, path, plan with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = g.Version, Game = "Another game" }, "PUT"));
        Assert.Equal(2, g.Revision); Assert.All(g.Invites, i => Assert.Equal("Pending", i.State));
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner, path, plan with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = stale }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(a, path + "/response", new GatheringResponseRequest(Guid.NewGuid(), 1, "Accepted"), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(a, path + "/comments", new GatheringCommentRequest(Guid.NewGuid(), 1, "Old plan"))).StatusCode);
        // A replay acknowledges the old command without reviving its previous response.
        g = await Result(await Command(d, path + "/response", clarify, "PUT")); Assert.All(g.Invites, i => Assert.Equal("Pending", i.State));
        var history = (await a.GetFromJsonAsync<GatheringRevisionDto[]>(path + "/revisions"))!;
        Assert.Single(history); Assert.Contains("NeedsClarification", history[0].ResponsesJson); Assert.Contains("Chess", history[0].PlanJson);
        var notices = (await a.GetFromJsonAsync<GatheringNotices>(Root(c) + "/notices"))!; Assert.Contains(notices.Items, n => n.Kind == "reconfirmation");
        var notice = notices.Items[0]; Assert.Equal(HttpStatusCode.NoContent, (await Command(a, Root(c) + $"/notices/{notice.Id}/seen", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(b, Root(c) + $"/notices/{notice.Id}/seen", new { })).StatusCode);
    }
    [Fact]
    public async Task UninvitedMembersCannotReadOrMutateAndRejoiningDoesNotReviveAnInvitation()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var invited = host.CreateClient(); using var other = host.CreateClient(); using var anonymous = host.CreateClient();
        await Register(owner); var member = await Register(invited); await Register(other); var c = await CreateCommunity(owner); await Join(owner, invited, c); await Join(owner, other, c);
        var plan = Plan(member); var g = await Result(await Command(owner, Root(c), plan)); var path = Root(c) + "/" + g.Id;
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);
        Assert.Empty((await other.GetFromJsonAsync<GatheringList>(Root(c)))!.Items);
        foreach (var suffix in new[] { "", "/revisions" }) Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(path + suffix)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(other, path + "/comments", new GatheringCommentRequest(Guid.NewGuid(), 1, "Unauthorized"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(invited, path, plan with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = g.Version }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(owner, path + "/response", new GatheringResponseRequest(Guid.NewGuid(), 1, "Accepted"), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(invited, $"/api/v1/communities/{c.Id}/leave", new { })).StatusCode);
        await Join(owner, invited, c); Assert.Equal(HttpStatusCode.NotFound, (await invited.GetAsync(path)).StatusCode);
        Assert.Empty((await invited.GetFromJsonAsync<GatheringNotices>(Root(c) + "/notices"))!.Items);
        g = (await owner.GetFromJsonAsync<GatheringDto>(path))!; Assert.Empty(g.Invites);
        g = await Result(await Command(owner, path, plan with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = g.Version }, "PUT"));
        Assert.Equal("Pending", g.Invites.Single().State); Assert.Equal(HttpStatusCode.OK, (await invited.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(owner, $"/api/v1/communities/{c.Id}/members/{member.Id}/ban", new { Banned = true }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await invited.GetAsync(path)).StatusCode);
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False((await db.GatheringInvites.SingleAsync(i => i.GatheringId == Guid.Parse(g.Id))).Active);
        Assert.NotEmpty(await db.GatheringEvents.Where(e => e.GatheringId == Guid.Parse(g.Id) && e.PublishedAt == null).ToArrayAsync());
    }
    [Fact]
    public async Task ClosedGatheringsRejectNewActionsAndCannotBeCompletedEarly()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); var p = await Register(member); var c = await CreateCommunity(owner); await Join(owner, member, c);
        var g = await Result(await Command(owner, Root(c), Plan(p))); var path = Root(c) + "/" + g.Id;
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(owner, path + "/status", new GatheringStatusRequest(Guid.NewGuid(), g.Version, "Completed"), "PUT")).StatusCode);
        var cancel = new GatheringStatusRequest(Guid.NewGuid(), g.Version, "Cancelled");
        g = await Result(await Command(owner, path + "/status", cancel, "PUT")); Assert.Equal("Cancelled", g.Status); Assert.False(g.CanRespond);
        Assert.Equal(g.Version, (await Result(await Command(owner, path + "/status", cancel, "PUT"))).Version);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member, path + "/response", new GatheringResponseRequest(Guid.NewGuid(), 1, "Accepted"), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner, path + "/comments", new GatheringCommentRequest(Guid.NewGuid(), 1, "Closed"))).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(owner, Root(c), Plan(p) with { LocalStart = "2020-01-01T12:00" })).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(owner, Root(c), Plan(p) with { Participants = [] })).StatusCode);
    }
    [Fact]
    public async Task CoversArePrivateBoundedPayloadBoundAndPreserveDecisions()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var member = host.CreateClient(); using var other = host.CreateClient();
        await Register(owner); var p = await Register(member); await Register(other); var c = await CreateCommunity(owner); await Join(owner, member, c); await Join(owner, other, c);
        var g = await Result(await Command(owner, Root(c), Plan(p))); var path = Root(c) + "/" + g.Id;
        g = await Result(await Command(member, path + "/response", new GatheringResponseRequest(Guid.NewGuid(), 1, "Accepted"), "PUT"));
        var bytes = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ2sAAAAASUVORK5CYII=");
        async Task<HttpResponseMessage> Upload(HttpClient client, Guid id, string version, byte[] data)
        {
            var csrf = (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!;
            using var request = new HttpRequestMessage(HttpMethod.Post, path + "/cover"); request.Headers.Add("X-CSRF-TOKEN", csrf.RequestToken);
            var form = new MultipartFormDataContent { { new StringContent(id.ToString()), "clientRequestId" }, { new StringContent(version), "expectedVersion" }, { new ByteArrayContent(data), "file", "cover.png" } }; request.Content = form;
            return await client.SendAsync(request);
        }
        var id = Guid.NewGuid(); var oldVersion = g.Version; g = await Result(await Upload(owner, id, oldVersion, bytes));
        Assert.Equal("Accepted", g.Invites.Single().State); Assert.Equal(1, g.Revision); Assert.NotNull(g.CoverId);
        Assert.Equal(g.Version, (await Result(await Upload(owner, id, oldVersion, bytes))).Version);
        var imagePath = path + "/cover/" + g.CoverId; using var image = await member.GetAsync(imagePath);
        Assert.Equal(HttpStatusCode.OK, image.StatusCode); Assert.Equal("image/png", image.Content.Headers.ContentType!.MediaType); Assert.True(image.Headers.CacheControl!.NoStore);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(imagePath)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Upload(member, Guid.NewGuid(), g.Version, bytes)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Upload(owner, Guid.NewGuid(), g.Version, [1, 2, 3])).StatusCode);
        g = await Result(await Command(owner, path + "/cover/remove", new GatheringCoverRequest(Guid.NewGuid(), g.Version)));
        Assert.Null(g.CoverId); Assert.Equal("Accepted", g.Invites.Single().State); Assert.Equal(HttpStatusCode.NotFound, (await member.GetAsync(imagePath)).StatusCode);
    }
}
