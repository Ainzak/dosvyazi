using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.Voice;
using App.Api.Infrastructure.Persistence;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace App.IntegrationTests;

[Trait("Category", "PostgreSQL")]
public sealed class VoiceTests(AccountsDatabase storage) : IClassFixture<AccountsDatabase>
{
    private const string Secret = "synthetic_test_secret_32_characters_minimum";
    private FoundationFactory Factory(FakeVoice voice) => new(connection: storage.Connection, voice: voice);
    private static string Path(string community, string suffix = "") => $"/api/v1/communities/{community}/voice{suffix}";
    private static async Task<HttpResponseMessage> Send(HttpClient client, string path, object? body = null, string method = "POST")
    {
        var csrf = (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!.RequestToken;
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        request.Headers.Add("X-CSRF-TOKEN", csrf);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await client.SendAsync(request);
    }
    private static async Task<UserProfile> Register(HttpClient client)
    {
        using var response = await Send(client, "/api/v1/account/register", new { Email = $"voice-{Guid.NewGuid():N}@example.test", Password = "Synthetic voice passphrase 42", DisplayName = "Voice member" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<UserProfile>())!;
    }
    private static async Task<string> Create(HttpClient client)
    {
        using var response = await Send(client, "/api/v1/communities", new { ClientRequestId = Guid.NewGuid(), Name = "Voice test" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CommunityDetails>())!.Id;
    }
    private static async Task AddMember(HttpClient owner, HttpClient member, string community)
    {
        using var invite = await Send(owner, $"/api/v1/communities/{community}/invites", new { ClientRequestId = Guid.NewGuid(), LifetimeHours = 24, MaxUses = 3 });
        var code = (await invite.Content.ReadFromJsonAsync<CreatedInvite>())!.Code;
        Assert.Equal(HttpStatusCode.OK, (await Send(member, "/api/v1/communities/join", new { Code = code })).StatusCode);
    }
    private static async Task<VoiceJoinDto> Grant(HttpClient client, string community)
    {
        using var response = await Send(client, Path(community, "/join"), new JoinVoiceRequest(Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<VoiceJoinDto>())!;
    }
    private static async Task Reconcile(FoundationFactory host, string community)
    {
        using var scope = host.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<VoiceReconciler>().ReconcileAsync(Guid.Parse(community), default);
    }

    [Fact]
    public async Task GrantsAreMemberOnlyCsrfProtectedIdempotentAndBoundToCommunity()
    {
        var voice = new FakeVoice();
        await using var host = Factory(voice);
        using var owner = host.CreateClient(); using var outsider = host.CreateClient(); using var anonymous = host.CreateClient();
        var profile = await Register(owner); await Register(outsider);
        var community = await Create(owner); var other = await Create(owner);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Path(community))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(Path(community))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(outsider, Path(community, "/join"), new JoinVoiceRequest(Guid.NewGuid()))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(Path(community, "/join"), new JoinVoiceRequest(Guid.NewGuid()))).StatusCode);
        var request = new JoinVoiceRequest(Guid.NewGuid());
        var results = await Task.WhenAll(Send(owner, Path(community, "/join"), request), Send(owner, Path(community, "/join"), request));
        foreach (var result in results) Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        var first = (await results[0].Content.ReadFromJsonAsync<VoiceJoinDto>())!;
        Assert.Equal(first, await results[1].Content.ReadFromJsonAsync<VoiceJoinDto>());
        Assert.Equal(HttpStatusCode.Conflict, (await Send(owner, Path(other, "/join"), request)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(owner, Path(other, "/join"), new JoinVoiceRequest(Guid.NewGuid()))).StatusCode);
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.VoiceLeases.CountAsync(item => item.UserId == Guid.Parse(profile.Id) && item.Active));
        var saved = await db.VoiceGrantRequests.SingleAsync(item => item.ClientRequestId == request.ClientRequestId);
        Assert.DoesNotContain(first.Token, saved.ProtectedToken);
        saved.ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1); await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await Send(owner, Path(community, "/join"), request)).StatusCode);
        foreach (var result in results) result.Dispose();
    }

    [Theory]
    [InlineData("ban")]
    [InlineData("leave")]
    [InlineData("logout")]
    public async Task RevocationPersistsFreezeAndSurvivesControlFailureAndHostRestart(string action)
    {
        var voice = new FakeVoice();
        await using var host = Factory(voice);
        using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); var profile = await Register(member);
        var community = await Create(owner); await AddMember(owner, member, community);
        var grant = await Grant(member, community);
        var mutation = action switch
        {
            "ban" => await Send(owner, $"/api/v1/communities/{community}/members/{profile.Id}/ban", new { Banned = true }, "PUT"),
            "leave" => await Send(member, $"/api/v1/communities/{community}/leave"),
            _ => await Send(member, "/api/v1/account/logout"),
        };
        Assert.True(mutation.IsSuccessStatusCode);
        var pending = (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!;
        Assert.Equal("Pending", pending.Status); Assert.NotNull(pending.OperationId); Assert.Null(pending.CompletedAt);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(owner, Path(community, "/join"), new JoinVoiceRequest(Guid.NewGuid()))).StatusCode);
        voice.Fail = true; await Reconcile(host, community);
        pending = (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!;
        Assert.Equal("Pending", pending.Status); Assert.True(pending.ControlUnavailable); Assert.Equal("1", pending.Generation);
        await using var restarted = Factory(voice);
        voice.Fail = false; await Reconcile(restarted, community);
        var completed = (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!;
        Assert.Equal("Ready", completed.Status); Assert.Equal("2", completed.Generation);
        Assert.Equal(pending.OperationId, completed.OperationId); Assert.NotNull(completed.CompletedAt);
        var next = await Grant(owner, community); Assert.NotEqual(grant.Identity, next.Identity);
        await Reconcile(restarted, community);
        Assert.Equal("2", (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!.Generation);
        using var scope = restarted.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False((await db.VoiceLeases.SingleAsync(item => item.Id == Guid.Parse(grant.LeaseId))).Active);
        var retired = await db.RetiredVoiceRooms.SingleAsync(item => item.CommunityId == Guid.Parse(community));
        Assert.Contains(new VoiceRoom(retired.RoomId, retired.Generation).Name, voice.Deleted);
    }

    [Fact]
    public async Task OldLeaveAndOldWebhookCannotClearNewLeaseAndForgedOrAlteredWebhookIsDenied()
    {
        var voice = new FakeVoice(); await using var host = Factory(voice);
        using var client = host.CreateClient(); await Register(client); var community = await Create(client);
        var old = await Grant(client, community);
        Assert.Equal(HttpStatusCode.OK, (await Send(client, Path(community, "/leave"), new VoiceLeaseRequest(Guid.Parse(old.LeaseId)))).StatusCode);
        await Reconcile(host, community); var current = await Grant(client, community);
        await Send(client, Path(community, "/leave"), new VoiceLeaseRequest(Guid.Parse(old.LeaseId)));
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var room = await db.VoiceRooms.SingleAsync(item => item.CommunityId == Guid.Parse(community));
        var body = $"{{\"id\":\"{Guid.NewGuid():N}\",\"event\":\"participant_left\",\"room\":{{\"name\":\"{new VoiceRoom(room.Id, 1).Name}\"}},\"participant\":{{\"identity\":\"{old.Identity}\"}}}}";
        var jwt = new AccessToken("test_key", Secret).WithSha256(Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(body)))).ToJwt();
        async Task<HttpStatusCode> Webhook(string content, string token)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/voice/webhook") { Content = new StringContent(content, Encoding.UTF8, "application/json") };
            request.Headers.TryAddWithoutValidation("Authorization", token);
            return (await client.SendAsync(request)).StatusCode;
        }
        Assert.Equal(HttpStatusCode.Unauthorized, await Webhook(body, "forged"));
        Assert.Equal(HttpStatusCode.Unauthorized, await Webhook(body + " ", jwt));
        Assert.Equal(HttpStatusCode.OK, await Webhook(body, jwt)); Assert.Equal(HttpStatusCode.OK, await Webhook(body, jwt));
        db.ChangeTracker.Clear();
        Assert.True((await db.VoiceLeases.SingleAsync(item => item.Id == Guid.Parse(current.LeaseId))).Active);
        Assert.Equal("Ready", (await db.VoiceRooms.SingleAsync(item => item.CommunityId == Guid.Parse(community))).Status);
    }

    [Fact]
    public async Task WaitingGrantRechecksBanAfterWriterLock()
    {
        var voice = new FakeVoice(); await using var host = Factory(voice);
        using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); var profile = await Register(member); var community = await Create(owner); await AddMember(owner, member, community);
        await using var connection = new NpgsqlConnection(storage.Connection); await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using var locked = new NpgsqlCommand("SELECT \"Id\" FROM \"Communities\" WHERE \"Id\" = @id FOR UPDATE", connection, transaction);
        locked.Parameters.AddWithValue("id", Guid.Parse(community)); await locked.ExecuteScalarAsync();
        var waiting = Send(member, Path(community, "/join"), new JoinVoiceRequest(Guid.NewGuid()));
        bool observed = false;
        for (var attempt = 0; attempt < 100 && !observed; attempt++)
        {
            await using var clear = new NpgsqlCommand("SELECT pg_stat_clear_snapshot()", connection, transaction); await clear.ExecuteNonQueryAsync();
            await using var probe = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%Communities%FOR UPDATE%')", connection, transaction);
            observed = (bool)(await probe.ExecuteScalarAsync())!;
            if (!observed) await Task.Delay(20);
        }
        Assert.True(observed);
        await using var ban = new NpgsqlCommand("UPDATE \"Memberships\" SET \"Status\" = 'Banned' WHERE \"CommunityId\" = @id AND \"UserId\" = @user", connection, transaction);
        ban.Parameters.AddWithValue("id", Guid.Parse(community)); ban.Parameters.AddWithValue("user", Guid.Parse(profile.Id));
        await ban.ExecuteNonQueryAsync(); await transaction.CommitAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await waiting).StatusCode);
        using var scope = host.Services.CreateScope(); Assert.False(await scope.ServiceProvider.GetRequiredService<AppDbContext>().VoiceLeases.AnyAsync(item => item.UserId == Guid.Parse(profile.Id)));
    }

    [Fact]
    public async Task ExpiredLeaseFreezesBeforeControlAndUnknownSfuIdentityTriggersRotation()
    {
        var voice = new FakeVoice(); await using var host = Factory(voice);
        using var client = host.CreateClient(); await Register(client); var community = await Create(client); var grant = await Grant(client, community);
        using (var scope = host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.VoiceLeases.Where(item => item.Id == Guid.Parse(grant.LeaseId)).ExecuteUpdateAsync(setters => setters.SetProperty(item => item.ExpiresAt, DateTimeOffset.UtcNow.AddSeconds(-1)));
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Send(client, Path(community, "/heartbeat"), new VoiceLeaseRequest(Guid.Parse(grant.LeaseId)))).StatusCode);
        voice.Fail = true; await Reconcile(host, community);
        Assert.Equal("Pending", (await client.GetFromJsonAsync<VoiceStateDto>(Path(community)))!.Status);
        voice.Fail = false; await Reconcile(host, community); await Grant(client, community);
        voice.Unknown = true; await Reconcile(host, community);
        Assert.Equal("Pending", (await client.GetFromJsonAsync<VoiceStateDto>(Path(community)))!.Status);
        voice.Unknown = false; await Reconcile(host, community);
        Assert.Equal("3", (await client.GetFromJsonAsync<VoiceStateDto>(Path(community)))!.Generation);
    }

    [Fact]
    public async Task TwoHostsSerializeAccountJoinsAndCopiedSessionCannotOutliveLogout()
    {
        var voice = new FakeVoice(); await using var first = Factory(voice); await using var second = Factory(voice);
        using var client = first.CreateClient(); var user = await Register(client);
        var community = await Create(client); var other = await Create(client);
        using var login = await Send(client, "/api/v1/account/login", new { user.Email, Password = "Synthetic voice passphrase 42" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var cookie = login.Headers.GetValues("Set-Cookie").First(value => value.StartsWith("dosvyazi.session=", StringComparison.Ordinal)).Split(';')[0];
        using var copy = second.CreateClient(); copy.DefaultRequestHeaders.Add("Cookie", cookie);
        var results = await Task.WhenAll(Send(client, Path(community, "/join"), new JoinVoiceRequest(Guid.NewGuid())),
            Send(copy, Path(other, "/join"), new JoinVoiceRequest(Guid.NewGuid())));
        Assert.Single(results, item => item.StatusCode == HttpStatusCode.OK); Assert.Single(results, item => item.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, "/api/v1/account/logout")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await copy.GetAsync(Path(community))).StatusCode);
        using var scope = second.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.VoiceLeases.AnyAsync(item => item.UserId == Guid.Parse(user.Id) && item.Active));
        Assert.Single(await db.VoiceRooms.Where(item => item.Status == "Pending" && (item.CommunityId == Guid.Parse(community) || item.CommunityId == Guid.Parse(other))).ToArrayAsync());
        foreach (var response in results) response.Dispose();
    }

    private sealed class FakeVoice : IVoiceGateway
    {
        public bool Fail { get; set; }
        public bool Unknown { get; set; }
        public List<string> Deleted { get; } = [];
        public VoiceGrant CreateGrant(VoiceRoom room, Guid identity, bool canSpeak) => new($"synthetic-{room.Name}-{identity:N}", DateTimeOffset.FromUnixTimeSeconds(DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 60));
        private Task Check() => Fail ? Task.FromException(new VoiceGatewayException()) : Task.CompletedTask;
        public Task CreateRoomAsync(VoiceRoom room, CancellationToken ct) => Check();
        public async Task DeleteRoomAsync(VoiceRoom room, CancellationToken ct) { await Check(); Deleted.Add(room.Name); }
        public async Task<IReadOnlyList<VoiceParticipant>> ParticipantsAsync(VoiceRoom room, CancellationToken ct) { await Check(); return Unknown ? [new("unknown", true, 1)] : []; }
        public Task RemoveParticipantAsync(VoiceRoom room, Guid identity, CancellationToken ct) => Check();
        public Task RestrictSpeakingAsync(VoiceRoom room, Guid identity, CancellationToken ct) => Check();
    }
}
