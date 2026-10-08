using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace App.IntegrationTests;

[Trait("Category", "PostgreSQL")]
public sealed class CommunityTests(AccountsDatabase database) : IClassFixture<AccountsDatabase>
{
    private const string Password = "Synthetic community passphrase 42";
    private FoundationFactory Factory() => new(connection: database.Connection);
    private sealed record Person(HttpClient Client, UserProfile Profile) : IDisposable { public void Dispose() => Client.Dispose(); }
    private static async Task<string> Token(HttpClient client) => (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!.RequestToken;
    private static async Task<HttpResponseMessage> Send(HttpClient client, string path, object? body = null, string method = "POST", string? token = null)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        request.Headers.Add("X-CSRF-TOKEN", token ?? await Token(client));
        if (body is not null) request.Content = JsonContent.Create(body);
        return await client.SendAsync(request);
    }
    private static async Task<Person> User(FoundationFactory factory)
    {
        var client = factory.CreateClient();
        using var response = await Send(client, "/api/v1/account/register", new { Email = $"community-{Guid.NewGuid():N}@example.test", Password, DisplayName = "Synthetic member" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return new Person(client, (await response.Content.ReadFromJsonAsync<UserProfile>())!);
    }
    private static async Task<CommunityDetails> Create(Person owner)
    {
        using var response = await Send(owner.Client, "/api/v1/communities", new { ClientRequestId = Guid.NewGuid(), Name = "Synthetic community" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CommunityDetails>())!;
    }
    private static async Task<CreatedInvite> Invite(Person owner, CommunityDetails community, int uses = 10)
    {
        using var response = await Send(owner.Client, $"/api/v1/communities/{community.Id}/invites", new { ClientRequestId = Guid.NewGuid(), LifetimeHours = 24, MaxUses = uses });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CreatedInvite>())!;
    }
    private static Task<HttpResponseMessage> Join(Person user, CreatedInvite invite) => Send(user.Client, "/api/v1/communities/join", new { invite.Code });

    [Fact]
    public async Task ConcurrentCreationIsAtomicIdempotentAndPayloadBound()
    {
        await using var factory = Factory();
        using var owner = await User(factory);
        var request = new { ClientRequestId = Guid.NewGuid(), Name = "  Shared space  ", OwnerId = Guid.NewGuid() };
        var responses = await Task.WhenAll(Send(owner.Client, "/api/v1/communities", request), Send(owner.Client, "/api/v1/communities", request));
        foreach (var response in responses) Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var first = (await responses[0].Content.ReadFromJsonAsync<CommunityDetails>())!;
        var second = (await responses[1].Content.ReadFromJsonAsync<CommunityDetails>())!;
        Assert.Equal(first.Id, second.Id);
        Assert.Equal(owner.Profile.Id, first.OwnerId);
        Assert.Equal("Shared space", first.Name);
        Assert.Equal("Owner", first.Role);
        Assert.Equal("general", Assert.Single(first.Channels).Name);
        Assert.Equal(1, first.MemberCount);
        using var conflict = await Send(owner.Client, "/api/v1/communities", new { request.ClientRequestId, Name = "Different name" });
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await context.Communities.CountAsync(item => item.ClientRequestId == request.ClientRequestId));
        Assert.Equal(1, await context.TextChannels.CountAsync(item => item.CommunityId == Guid.Parse(first.Id)));
        foreach (var response in responses) response.Dispose();
    }

    [Fact]
    public async Task AnonymousNonmembersAndMembersHaveSeparateResourceBoundaries()
    {
        await using var factory = Factory();
        using var owner = await User(factory);
        using var member = await User(factory);
        using var stranger = await User(factory);
        using var anonymous = factory.CreateClient();
        var community = await Create(owner);
        var channel = Assert.Single(community.Channels);
        foreach (var path in new[] { "/api/v1/communities", $"/api/v1/communities/{community.Id}", $"/api/v1/communities/{community.Id}/channels/{channel.Id}" })
            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);
        foreach (var suffix in new[] { "", "/members", "/invites", $"/channels/{channel.Id}" })
        {
            using var response = await stranger.Client.GetAsync($"/api/v1/communities/{community.Id}{suffix}");
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.DoesNotContain(community.Name, await response.Content.ReadAsStringAsync());
        }
        Assert.Empty((await stranger.Client.GetFromJsonAsync<CommunitySummary[]>("/api/v1/communities"))!);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync("/api/v1/communities", new { ClientRequestId = Guid.NewGuid(), Name = "Missing CSRF" })).StatusCode);
        var invite = await Invite(owner, community);
        Assert.Equal(HttpStatusCode.OK, (await Join(member, invite)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync($"/api/v1/communities/{community.Id}/channels/{channel.Id}")).StatusCode);
        foreach (var suffix in new[] { "/members", "/invites" }) Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync($"/api/v1/communities/{community.Id}{suffix}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(member.Client, $"/api/v1/communities/{community.Id}/invites", new { ClientRequestId = Guid.NewGuid(), LifetimeHours = 24, MaxUses = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(member.Client, $"/api/v1/communities/{community.Id}/members/{owner.Profile.Id}/ban", new { Banned = true }, "PUT")).StatusCode);
    }

    [Fact]
    public async Task ConcurrentSingleUseInviteAcrossHostsAdmitsExactlyOneNewMember()
    {
        await using var firstHost = Factory();
        await using var secondHost = Factory();
        using var owner = await User(firstHost);
        using var first = await User(firstHost);
        using var second = await User(secondHost);
        var community = await Create(owner);
        var invite = await Invite(owner, community, 1);
        var responses = await Task.WhenAll(Join(first, invite), Join(second, invite));
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.NotFound);
        var winner = responses[0].IsSuccessStatusCode ? first : second;
        Assert.Equal(HttpStatusCode.OK, (await Join(winner, invite)).StatusCode);
        var metadata = (await owner.Client.GetFromJsonAsync<InviteSummary[]>($"/api/v1/communities/{community.Id}/invites"))!;
        Assert.Equal(1, Assert.Single(metadata).Uses);
        Assert.Equal(2, (await owner.Client.GetFromJsonAsync<CommunityDetails>($"/api/v1/communities/{community.Id}"))!.MemberCount);
        foreach (var response in responses) response.Dispose();
    }

    [Fact]
    public async Task ConcurrentRepeatedJoinConsumesOnlyOneUse()
    {
        await using var factory = Factory();
        using var owner = await User(factory);
        using var member = await User(factory);
        var community = await Create(owner);
        var invite = await Invite(owner, community, 1);
        var responses = await Task.WhenAll(Join(member, invite), Join(member, invite));
        foreach (var response in responses) { Assert.Equal(HttpStatusCode.OK, response.StatusCode); response.Dispose(); }
        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await context.Memberships.CountAsync(item => item.CommunityId == Guid.Parse(community.Id) && item.UserId == Guid.Parse(member.Profile.Id)));
        Assert.Equal(1, (await context.CommunityInvites.SingleAsync(item => item.Id == Guid.Parse(invite.Invite.Id))).Uses);
    }

    [Fact]
    public async Task RevokedExpiredAndUnknownCodesCannotGrantMembership()
    {
        await using var factory = Factory();
        using var owner = await User(factory);
        using var member = await User(factory);
        var community = await Create(owner);
        var revoked = await Invite(owner, community);
        for (var attempt = 0; attempt < 2; attempt++) Assert.Equal(HttpStatusCode.OK, (await Send(owner.Client, $"/api/v1/communities/{community.Id}/invites/{revoked.Invite.Id}/revoke")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Join(member, revoked)).StatusCode);
        var expired = await Invite(owner, community);
        using var scope = factory.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().CommunityInvites.Where(item => item.Id == Guid.Parse(expired.Invite.Id))
            .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.ExpiresAt, DateTimeOffset.UtcNow.AddSeconds(-1)));
        Assert.Equal(HttpStatusCode.NotFound, (await Join(member, expired)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(member.Client, "/api/v1/communities/join", new { Code = new string('0', 64) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(member.Client, "/api/v1/communities/join", new { Code = "invalid" })).StatusCode);
        Assert.Empty((await member.Client.GetFromJsonAsync<CommunitySummary[]>("/api/v1/communities"))!);
    }

    [Fact]
    public async Task BanLiftAndLeaveEnforceCurrentMembershipWithoutAffectingOtherCommunities()
    {
        await using var factory = Factory();
        using var owner = await User(factory);
        using var member = await User(factory);
        var community = await Create(owner);
        var other = await Create(member);
        var invite = await Invite(owner, community);
        await Join(member, invite);
        var target = $"/api/v1/communities/{community.Id}/members/{member.Profile.Id}/ban";
        for (var attempt = 0; attempt < 2; attempt++) Assert.Equal(HttpStatusCode.OK, (await Send(owner.Client, target, new { Banned = true }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync($"/api/v1/communities/{community.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Join(member, invite)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(member.Client, $"/api/v1/communities/{community.Id}/leave")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync($"/api/v1/communities/{other.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(owner.Client, target, new { Banned = false }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync($"/api/v1/communities/{community.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Join(member, invite)).StatusCode);
        for (var attempt = 0; attempt < 2; attempt++) Assert.Equal(HttpStatusCode.OK, (await Send(member.Client, $"/api/v1/communities/{community.Id}/leave")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync($"/api/v1/communities/{community.Id}/channels/{community.Channels[0].Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(owner.Client, $"/api/v1/communities/{community.Id}/leave")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(owner.Client, $"/api/v1/communities/{community.Id}/members/{owner.Profile.Id}/ban", new { Banned = true }, "PUT")).StatusCode);
    }

    [Fact]
    public async Task ChannelInviteAndMemberIdentifiersCannotCrossCommunityBoundaries()
    {
        await using var factory = Factory();
        using var owner = await User(factory);
        using var otherOwner = await User(factory);
        var first = await Create(owner);
        var second = await Create(otherOwner);
        var invite = await Invite(otherOwner, second);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync($"/api/v1/communities/{first.Id}/channels/{second.Channels[0].Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(owner.Client, $"/api/v1/communities/{first.Id}/invites/{invite.Invite.Id}/revoke")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(owner.Client, $"/api/v1/communities/{first.Id}/members/{otherOwner.Profile.Id}/ban", new { Banned = true }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(owner.Client, $"/api/v1/communities/{second.Id}/invites", new { ClientRequestId = Guid.NewGuid(), LifetimeHours = 24, MaxUses = 1 })).StatusCode);
    }

    [Fact]
    public async Task InvitationCreationRetriesPreserveCodeAndDoNotLeakItInMetadata()
    {
        await using var factory = Factory();
        using var owner = await User(factory);
        var community = await Create(owner);
        var request = new { ClientRequestId = Guid.NewGuid(), LifetimeHours = 24, MaxUses = 2 };
        var path = $"/api/v1/communities/{community.Id}/invites";
        var responses = await Task.WhenAll(Send(owner.Client, path, request), Send(owner.Client, path, request));
        var first = (await responses[0].Content.ReadFromJsonAsync<CreatedInvite>())!;
        var second = (await responses[1].Content.ReadFromJsonAsync<CreatedInvite>())!;
        Assert.Equal(first, second);
        using var conflict = await Send(owner.Client, path, new { request.ClientRequestId, LifetimeHours = 24, MaxUses = 3 });
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        var metadata = await owner.Client.GetStringAsync(path);
        Assert.DoesNotContain(first.Code, metadata);
        Assert.DoesNotContain("codeHash", metadata);
        Assert.DoesNotContain("protectedCode", metadata);
        using var scope = factory.Services.CreateScope();
        var saved = await scope.ServiceProvider.GetRequiredService<AppDbContext>().CommunityInvites.SingleAsync(item => item.Id == Guid.Parse(first.Invite.Id));
        Assert.NotEqual(first.Code, saved.CodeHash);
        Assert.DoesNotContain(first.Code, saved.ProtectedCode);
        foreach (var response in responses) response.Dispose();
    }

    [Fact]
    public async Task CommunityAndProtectedInvitationSurviveHostRestart()
    {
        CommunityDetails community;
        CreatedInvite invite;
        UserProfile profile;
        var request = new { ClientRequestId = Guid.NewGuid(), LifetimeHours = 24, MaxUses = 2 };
        await using (var first = Factory())
        {
            using var owner = await User(first);
            profile = owner.Profile;
            community = await Create(owner);
            using var response = await Send(owner.Client, $"/api/v1/communities/{community.Id}/invites", request);
            invite = (await response.Content.ReadFromJsonAsync<CreatedInvite>())!;
        }
        await using var restarted = Factory();
        using var client = restarted.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await Send(client, "/api/v1/account/login", new { profile.Email, Password })).StatusCode);
        var persisted = (await client.GetFromJsonAsync<CommunityDetails>($"/api/v1/communities/{community.Id}"))!;
        Assert.Equal(community.Channels[0].Id, persisted.Channels[0].Id);
        using var retry = await Send(client, $"/api/v1/communities/{community.Id}/invites", request);
        Assert.Equal(invite, await retry.Content.ReadFromJsonAsync<CreatedInvite>());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task WaitingJoinRechecksCommittedRevocationOrBan(bool ban)
    {
        await using var factory = Factory();
        using var owner = await User(factory);
        using var member = await User(factory);
        var community = await Create(owner);
        var invite = await Invite(owner, community);
        if (ban) { await Join(member, invite); await Send(member.Client, $"/api/v1/communities/{community.Id}/leave"); }
        var token = await Token(member.Client);
        await using var connection = new NpgsqlConnection(database.Connection);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using var locked = new NpgsqlCommand("SELECT \"Id\" FROM \"Communities\" WHERE \"Id\" = @id FOR UPDATE", connection, transaction);
        locked.Parameters.AddWithValue("id", Guid.Parse(community.Id));
        await locked.ExecuteScalarAsync();
        await using var change = new NpgsqlCommand(ban
            ? "UPDATE \"Memberships\" SET \"Status\" = 'Banned' WHERE \"CommunityId\" = @id AND \"UserId\" = @user"
            : "UPDATE \"CommunityInvites\" SET \"RevokedAt\" = now() WHERE \"CommunityId\" = @id", connection, transaction);
        change.Parameters.AddWithValue("id", Guid.Parse(community.Id));
        if (ban) change.Parameters.AddWithValue("user", Guid.Parse(member.Profile.Id));
        await change.ExecuteNonQueryAsync();
        var waiting = Send(member.Client, "/api/v1/communities/join", new { invite.Code }, token: token);
        var observedLock = false;
        for (var attempt = 0; attempt < 100 && !observedLock; attempt++)
        {
            // PostgreSQL caches monitoring snapshots inside a transaction; refresh
            // this observation without releasing the intentionally held writer lock.
            await using var clear = new NpgsqlCommand("SELECT pg_stat_clear_snapshot()", connection, transaction);
            await clear.ExecuteNonQueryAsync();
            await using var probe = new NpgsqlCommand("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%' AND pid <> pg_backend_pid())", connection, transaction);
            observedLock = (bool)(await probe.ExecuteScalarAsync())!;
            if (!observedLock) await Task.Delay(10);
        }
        Assert.True(observedLock, "The join must wait for the community writer lock.");
        Assert.False(waiting.IsCompleted);
        await transaction.CommitAsync();
        using var response = await waiting.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Empty((await member.Client.GetFromJsonAsync<CommunitySummary[]>("/api/v1/communities"))!);
    }
}
