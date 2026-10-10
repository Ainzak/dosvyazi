using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace App.IntegrationTests;

[Trait("Category", "PostgreSQL")]
public sealed class AccessTests(AccountsDatabase database) : IClassFixture<AccountsDatabase>
{
    private FoundationFactory Factory() => new(connection: database.Connection, permitLimit: 120);
    private sealed record Person(HttpClient Client, UserProfile Profile, string Cookie) : IDisposable { public void Dispose() => Client.Dispose(); }
    private static async Task<HttpResponseMessage> Command(HttpClient client, string path, object? body = null, string method = "POST")
    {
        var csrf = (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!;
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        request.Headers.Add("X-CSRF-TOKEN", csrf.RequestToken);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await client.SendAsync(request);
    }
    private static async Task<Person> User(FoundationFactory factory)
    {
        var client = factory.CreateClient();
        using var response = await Command(client, "/api/v1/account/register", new { Email = $"access-{Guid.NewGuid():N}@example.test", Password = "Synthetic access passphrase 42", DisplayName = "Access tester" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return new(client, (await response.Content.ReadFromJsonAsync<UserProfile>())!, response.Headers.GetValues("Set-Cookie").Single(v => v.StartsWith("dosvyazi.session=", StringComparison.Ordinal)).Split(';')[0]);
    }
    private static string Root(CommunityDetails c) => $"/api/v1/communities/{c.Id}";
    private static string Channel(CommunityDetails c) => Root(c) + $"/channels/{c.Channels[0].Id}";
    private static async Task<CommunityDetails> Create(Person owner)
    {
        using var response = await Command(owner.Client, "/api/v1/communities", new CreateCommunityRequest(Guid.NewGuid(), "Access community"));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CommunityDetails>())!;
    }
    private static async Task Join(Person owner, Person member, CommunityDetails community)
    {
        using var response = await Command(owner.Client, Root(community) + "/invites", new CreateInviteRequest(Guid.NewGuid(), 24, 10));
        var invite = (await response.Content.ReadFromJsonAsync<CreatedInvite>())!;
        using var join = await Command(member.Client, "/api/v1/communities/join", new AcceptInviteRequest(invite.Code));
        Assert.Equal(HttpStatusCode.OK, join.StatusCode);
    }
    private static async Task<AccessPolicy> Policy(Person owner, CommunityDetails c) => (await owner.Client.GetFromJsonAsync<AccessPolicy>(Root(c) + "/access"))!;
    private static Task<HttpResponseMessage> Save(Person owner, CommunityDetails c, AccessPolicy p, Guid? request = null) => Command(owner.Client, Root(c) + "/access", new SaveAccessRequest(request ?? Guid.NewGuid(), p), "PUT");

    [Fact]
    public async Task PrivateChannelFiltersNavigationAndDeniesHistoryRecoverySendAndRouting()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory); using var outsider = await User(factory);
        var c = await Create(owner); await Join(owner, member, c);
        using var message = await Command(owner.Client, Channel(c) + "/messages", new SendMessageRequest(Guid.NewGuid(), "Private history"));
        Assert.Equal(HttpStatusCode.Created, message.StatusCode);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var session = await db.Sessions.Include(s => s.User).SingleAsync(s => s.UserId == Guid.Parse(member.Profile.Id));
        var aborted = false; var routing = factory.Services.GetRequiredService<MessageConnections>();
        var connection = new MessageConnection("private-policy-test", session.UserId, session.Id, session.User.SecurityStamp!, Guid.Parse(c.Id), Guid.Parse(c.Channels[0].Id), () => aborted = true);
        Assert.True(routing.Add(connection)); Assert.True(await MessageConnections.AuthorizedAsync(db, connection, CancellationToken.None));
        var p = await Policy(owner, c);
        using var saved = await Save(owner, c, p with { Roles = p.Roles.Select(r => r with { Grants = 0 }).ToArray() });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Empty((await member.Client.GetFromJsonAsync<CommunityDetails>(Root(c)))!.Channels);
        Assert.Single((await owner.Client.GetFromJsonAsync<CommunityDetails>(Root(c)))!.Channels);
        foreach (var path in new[] { Channel(c), Channel(c) + "/messages", Channel(c) + "/events?after=0" })
            Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(path)).StatusCode);
        using var denied = await Command(member.Client, Channel(c) + "/messages", new SendMessageRequest(Guid.NewGuid(), "Denied"));
        Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
        await scope.ServiceProvider.GetRequiredService<EventPublisher>().ReconcileAsync(CancellationToken.None);
        Assert.True(aborted); Assert.Empty(routing.All());
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync(Root(c) + "/access")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync(Root(c) + "/access")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Save(member, c, await Policy(owner, c))).StatusCode);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CategoryAndOtherRoleDeniesWinOverChannelAllowAndOwnerHasException(bool categoryDeny)
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory);
        var c = await Create(owner); await Join(owner, member, c);
        var p = await Policy(owner, c); var allowed = Guid.NewGuid(); var denied = Guid.NewGuid(); var category = Guid.NewGuid(); var channel = Guid.Parse(c.Channels[0].Id);
        p = p with {
            Roles = [new(Guid.Parse(c.Id), "everyone", 0), new(allowed, "Allowed", 3), new(denied, "Restricted", 0)],
            Categories = [new(category, "Restricted category")], Channels = [new(channel, "general", category)],
            Members = [new(Guid.Parse(member.Profile.Id), [allowed, denied])],
            CategoryRules = categoryDeny ? [new(category, denied, 0, 2)] : [],
            ChannelRules = categoryDeny ? [new(channel, allowed, 3, 0)] : [new(channel, allowed, 3, 0), new(channel, denied, 0, 2)] };
        Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, p)).StatusCode);
        var summary = await member.Client.GetFromJsonAsync<ChannelSummary>(Channel(c));
        Assert.False(summary!.CanSend); Assert.Contains(categoryDeny ? "category rule" : "channel rule", summary.SendDeniedBy!);
        using var blocked = await Command(member.Client, Channel(c) + "/messages", new SendMessageRequest(Guid.NewGuid(), "Cannot send")); Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        using var ownerSend = await Command(owner.Client, Channel(c) + "/messages", new SendMessageRequest(Guid.NewGuid(), "Owner exception")); Assert.Equal(HttpStatusCode.Created, ownerSend.StatusCode);
        p = (await Policy(owner, c)) with { CategoryRules = [new(category, denied, 0, 1)] };
        Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, p)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(Channel(c) + "/messages")).StatusCode);
        Assert.True((await owner.Client.GetFromJsonAsync<ChannelSummary>(Channel(c)))!.CanSend);
    }

    [Fact]
    public async Task RetriesAcrossHostsPersistOneReceiptAndStaleConcurrentSavesDoNotOverwrite()
    {
        await using var first = Factory(); await using var second = Factory(); using var owner = await User(first); var c = await Create(owner);
        using var replay = second.CreateClient(); replay.DefaultRequestHeaders.Add("Cookie", owner.Cookie);
        using var other = new Person(replay, owner.Profile, owner.Cookie);
        var p = await Policy(owner, c); var request = Guid.NewGuid();
        var results = await Task.WhenAll(Save(owner, c, p, request), Save(other, c, p, request));
        foreach (var r in results) Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(await results[0].Content.ReadFromJsonAsync<AccessSaved>(), await results[1].Content.ReadFromJsonAsync<AccessSaved>());
        Assert.Equal(HttpStatusCode.Conflict, (await Save(owner, c, p with { Roles = [new(Guid.Parse(c.Id), "everyone", 0)] }, request)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Save(owner, c, p)).StatusCode);
        p = await Policy(owner, c);
        results = await Task.WhenAll(Save(owner, c, p with { Roles = [new(Guid.Parse(c.Id), "everyone", 1)] }), Save(other, c, p with { Roles = [new(Guid.Parse(c.Id), "everyone", 2)] }));
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(results, r => r.StatusCode == HttpStatusCode.Conflict);
        using var scope = first.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(2, await db.AccessChanges.CountAsync(change => change.CommunityId == Guid.Parse(c.Id)));
    }

    [Fact]
    public async Task CrossCommunityReferencesInvalidRulesAndResourceRemovalAreRejected()
    {
        await using var factory = Factory(); using var owner = await User(factory); var a = await Create(owner); var b = await Create(owner); var p = await Policy(owner, a);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save(owner, a, p with { Channels = [..p.Channels, new(Guid.Parse(b.Channels[0].Id), "foreign", null)] })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save(owner, a, p with { Roles = [..p.Roles, new(Guid.Parse(b.Id), "foreign", 3)] })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save(owner, a, p with { ChannelRules = [new(Guid.Parse(b.Channels[0].Id), Guid.Parse(a.Id), 3, 0)] })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save(owner, a, p with { Channels = [new(Guid.NewGuid(), "replacement", null)] })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save(owner, a, p with { Roles = [new(Guid.Parse(a.Id), "everyone", 16)] })).StatusCode);
        Assert.Equal(p.Version, (await Policy(owner, a)).Version);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.MemberRoles.Add(new MemberRole { CommunityId = Guid.Parse(a.Id), UserId = Guid.Parse(owner.Profile.Id), RoleId = Guid.Parse(b.Id) });
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.IsType<Npgsql.PostgresException>(failure.InnerException);
        Assert.Equal("23503", ((Npgsql.PostgresException)failure.InnerException!).SqlState);
    }

    [Fact]
    public async Task LeavingAndRejoiningDoesNotRestorePrivateRoles()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory);
        var c = await Create(owner); await Join(owner, member, c); var p = await Policy(owner, c); var role = Guid.NewGuid();
        p = p with { Roles = [new(Guid.Parse(c.Id), "everyone", 0), new(role, "Private", 3)], Members = [new(Guid.Parse(member.Profile.Id), [role])] };
        Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, p)).StatusCode);
        Assert.Single((await member.Client.GetFromJsonAsync<CommunityDetails>(Root(c)))!.Channels);
        Assert.Equal(HttpStatusCode.OK, (await Command(member.Client, Root(c) + "/leave")).StatusCode);
        await Join(owner, member, c);
        Assert.Empty((await member.Client.GetFromJsonAsync<CommunityDetails>(Root(c)))!.Channels);
    }

    [Fact]
    public async Task DelegatedManagerCannotEscalateChangeHigherRolesOrReadPrivateMessages()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var manager = await User(factory); using var higher = await User(factory); using var lower = await User(factory);
        var c = await Create(owner); await Join(owner, manager, c); await Join(owner, higher, c); await Join(owner, lower, c);
        var managerRole = Guid.NewGuid(); var higherRole = Guid.NewGuid(); var lowerRole = Guid.NewGuid();
        const int grants = ChannelAccess.DefaultGrants | ChannelAccess.ManageRoles | ChannelAccess.ManageChannels | ChannelAccess.BanMembers | ChannelAccess.KickMembers | ChannelAccess.ManageInvites;
        var p = await Policy(owner, c);
        p = p with { Roles = [new(Guid.Parse(c.Id), "everyone", ChannelAccess.DefaultGrants, 0), new(managerRole, "Manager", grants, 50), new(higherRole, "Higher", 3, 80), new(lowerRole, "Lower", 3, 10)],
            Members = [new(Guid.Parse(manager.Profile.Id), [managerRole]), new(Guid.Parse(higher.Profile.Id), [higherRole]), new(Guid.Parse(lower.Profile.Id), [lowerRole])],
            ChannelRules = [new(Guid.Parse(c.Channels[0].Id), managerRole, 0, ChannelAccess.View)] };
        Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, p)).StatusCode);
        p = await Policy(manager, c);
        Assert.Equal(HttpStatusCode.NotFound, (await manager.Client.GetAsync(Channel(c) + "/messages")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Save(manager, c, p with { Roles = [..p.Roles, new(Guid.NewGuid(), "Helper", 3, 5)] })).StatusCode);
        p = await Policy(manager, c);
        Assert.Equal(HttpStatusCode.Forbidden, (await Save(manager, c, p with { Roles = [..p.Roles, new(Guid.NewGuid(), "Escalation", ChannelAccess.ModerateVoice, 5)] })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Save(manager, c, p with { Roles = [..p.Roles, new(Guid.NewGuid(), "Peer", 3, 50)] })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Save(manager, c, p with { Roles = p.Roles.Select(r => r.Id == managerRole ? r with { Name = "Self edited" } : r).ToArray() })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Save(manager, c, p with { ChannelRules = [] })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(manager.Client, Root(c) + $"/members/{higher.Profile.Id}/ban", new BanMemberRequest(true), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(manager.Client, Root(c) + $"/members/{higher.Profile.Id}/kick")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(manager.Client, Root(c) + $"/members/{lower.Profile.Id}/ban", new BanMemberRequest(true), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(manager.Client, Root(c) + $"/members/{lower.Profile.Id}/ban", new BanMemberRequest(true), "PUT")).StatusCode);
        var audit = (await manager.Client.GetFromJsonAsync<AuditDto[]>(Root(c) + "/audit"))!;
        Assert.Single(audit, a => a.Action == "member.banned");
        p = await Policy(owner, c);
        Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, p with { Members = p.Members.Where(m => m.UserId != Guid.Parse(manager.Profile.Id)).ToArray() })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.Client.GetAsync(Root(c) + "/access")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.Client.GetAsync(Root(c) + "/audit")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await manager.Client.GetAsync(Root(c))).StatusCode);
    }

    [Fact]
    public async Task KickIsRepeatSafeRevokesRolesAndAuditsOneAction()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory); var c = await Create(owner); await Join(owner, member, c);
        var path = Root(c) + $"/members/{member.Profile.Id}/kick";
        Assert.Equal(HttpStatusCode.OK, (await Command(owner.Client, path)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(owner.Client, path)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(Root(c))).StatusCode);
        Assert.Single((await owner.Client.GetFromJsonAsync<AuditDto[]>(Root(c) + "/audit"))!, a => a.Action == "member.removed");
    }
}
