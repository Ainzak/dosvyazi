using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging;
using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Communities;
using App.Api.Features.Voice;
using App.Api.Infrastructure.Persistence;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace App.IntegrationTests;

public sealed partial class VoiceTests
{
    [Fact]
    public async Task ProtectedControlReadFailureDoesNotRetireHealthyPeers()
    {
        var fake = new FakeVoice { Signed = true }; await using var host = Factory(fake, true); using var owner = host.CreateClient();
        await Register(owner); var community = await Create(owner); var grant = await Grant(owner, community);
        fake.Actual.Add(new(grant.Identity, true, 1)); fake.Fail = true;
        await Reconcile(host, community);
        var interrupted = (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!;
        Assert.Equal("Ready", interrupted.Status); Assert.True(interrupted.ControlUnavailable); Assert.Equal(grant.LeaseId, interrupted.MyLeaseId);
        fake.Fail = false; await Reconcile(host, community);
        var recovered = (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!;
        Assert.Equal(grant.Generation, recovered.Generation); Assert.Equal(grant.LeaseId, recovered.MyLeaseId); Assert.Empty(fake.Deleted);
    }

    [Fact]
    public async Task ProtectedControlFailureAfterRevocationKeepsDurableFallbackIntent()
    {
        var fake = new FakeVoice { Signed = true }; await using var host = Factory(fake, true); using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); await Register(member); var community = await Create(owner); await AddMember(owner, member, community);
        var peer = await Grant(owner, community); var target = await Grant(member, community);
        Assert.Equal(HttpStatusCode.OK, (await Send(owner, Path(community, "/disconnect"), new VoiceLeaseRequest(Guid.Parse(target.LeaseId)))).StatusCode);
        var scheduled = (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!;
        Assert.Equal("Ready", scheduled.Status); Assert.NotNull(scheduled.OperationId); Assert.Null(scheduled.CompletedAt);
        fake.Fail = true; await Reconcile(host, community);
        var pending = (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!; Assert.Equal("Pending", pending.Status); Assert.True(pending.ControlUnavailable);
        Assert.Equal(HttpStatusCode.Unauthorized, await Admission(member, target.Token));
        fake.Fail = false; await Reconcile(host, community);
        var recovered = (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!; Assert.Equal("Ready", recovered.Status); Assert.Equal("2", recovered.Generation); Assert.NotNull(recovered.CompletedAt);
        Assert.Null(recovered.MyLeaseId); Assert.NotEqual(peer.Generation, recovered.Generation);
    }

    [Fact]
    public async Task AdmissionAllowsSmallSfuNotBeforeClockLeadWithoutExtendingExpiration()
    {
        await using var host = Factory(new FakeVoice { Signed = true }, true); using var owner = host.CreateClient();
        await Register(owner); var community = await Create(owner); var grant = await Grant(owner, community);
        string Signed(int notBefore, int expires)
        {
            var handler = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler(); var original = handler.ReadJwtToken(grant.Token);
            original.Payload["nbf"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + notBefore;
            original.Payload["exp"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + expires;
            var key = new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(Secret));
            var credentials = new Microsoft.IdentityModel.Tokens.SigningCredentials(key, Microsoft.IdentityModel.Tokens.SecurityAlgorithms.HmacSha256);
            return handler.WriteToken(new System.IdentityModel.Tokens.Jwt.JwtSecurityToken(new(credentials), original.Payload));
        }
        Assert.Equal(HttpStatusCode.OK, await Admission(owner, Signed(3, 60)));
        Assert.Equal(HttpStatusCode.Unauthorized, await Admission(owner, Signed(20, 60)));
        Assert.Equal(HttpStatusCode.Unauthorized, await Admission(owner, Signed(-20, -1)));
    }

    [Fact]
    public async Task AdmissionSerializesUpstreamAcknowledgmentWithModeratorRevocation()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var serverBuilder = WebApplication.CreateBuilder(); serverBuilder.Logging.ClearProviders();
        serverBuilder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var server = serverBuilder.Build(); server.UseWebSockets();
        server.MapGet("/rtc", async context =>
        {
            entered.TrySetResult(); await release.Task.WaitAsync(context.RequestAborted);
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            try { await socket.ReceiveAsync(new byte[256], context.RequestAborted); }
            catch (Exception e) when (e is OperationCanceledException or System.Net.WebSockets.WebSocketException) { }
        });
        await server.StartAsync();
        var fake = new FakeVoice { Signed = true };
        await using var basis = Factory(fake, true);
        await using var host = basis.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.PostConfigure<VoiceOptions>(o => o.ControlUrl = server.Urls.Single())));
        using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); await Register(member); var community = await Create(owner); await AddMember(owner, member, community);
        var peer = await Grant(owner, community); var target = await Grant(member, community);
        fake.Actual.AddRange([new(peer.Identity, true, 1), new(target.Identity, true, 1)]);
        using var admissionScope = host.Services.CreateScope();
        var connecting = admissionScope.ServiceProvider.GetRequiredService<VoiceAdmission>().ConnectAsync(target.Token, "/rtc", "?access_token=" + Uri.EscapeDataString(target.Token), default);
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            var revoking = Send(owner, Path(community, "/disconnect"), new VoiceLeaseRequest(Guid.Parse(target.LeaseId)));
            await Task.Delay(150); Assert.False(revoking.IsCompleted);
            release.TrySetResult(); using var admitted = await connecting;
            using var revoked = await revoking; Assert.Equal(HttpStatusCode.OK, revoked.StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, await Admission(member, target.Token));
            using var scope = host.Services.CreateScope(); await scope.ServiceProvider.GetRequiredService<VoiceReconciler>().ReconcileAsync(Guid.Parse(community), default);
            Assert.Empty(fake.Deleted); Assert.Contains(Guid.Parse(target.LeaseId), fake.Removed);
            var state = (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!; Assert.Equal(peer.Generation, state.Generation); Assert.Equal(peer.LeaseId, state.MyLeaseId);
            await Assert.ThrowsAsync<CommunityFailure>(() => admissionScope.ServiceProvider.GetRequiredService<VoiceAdmission>().ConnectAsync(target.Token, "/rtc", "?access_token=" + Uri.EscapeDataString(target.Token), default));
        }
        finally { release.TrySetResult(); await server.StopAsync(); }
    }

    private static async Task<HttpStatusCode> Admission(HttpClient client, string token, string? origin = "http://localhost")
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/livekit/rtc/validate?access_token=" + Uri.EscapeDataString(token));
        if (origin is not null) request.Headers.Add("Origin", origin);
        using var result = await client.SendAsync(request); return result.StatusCode;
    }

    [Theory]
    [InlineData("disconnect")]
    [InlineData("ban")]
    [InlineData("logout")]
    public async Task ProtectedRevocationRejectsOriginalAndRefreshedTokensWithoutRetiringPeers(string operation)
    {
        var fake = new FakeVoice { Signed = true };
        await using var host = Factory(fake, true);
        using var owner = host.CreateClient(); using var member = host.CreateClient(); using var peer = host.CreateClient();
        await Register(owner); var person = await Register(member); await Register(peer);
        var community = await Create(owner); await AddMember(owner, member, community); await AddMember(owner, peer, community);
        var a = await Grant(owner, community); var b = await Grant(member, community); var c = await Grant(peer, community);
        foreach (var grant in new[] { a, b, c }) fake.Actual.Add(new(grant.Identity, true, 1));
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var room = await db.VoiceRooms.AsNoTracking().SingleAsync(r => r.ChannelId == Guid.Parse(community));
        var refreshed = new AccessToken("test_key", Secret).WithIdentity(b.Identity).WithExpiration(DateTime.UtcNow.AddMinutes(10))
            .WithGrants(new VideoGrants { Room = new VoiceRoom(room.Id, room.Generation).Name, RoomJoin = true, CanSubscribe = true,
                CanPublish = true, CanPublishData = false, CanUpdateOwnMetadata = false, CanPublishSources = ["microphone", "screen_share", "screen_share_audio", "camera"] }).ToJwt();
        Assert.Equal(HttpStatusCode.OK, await Admission(member, b.Token)); Assert.Equal(HttpStatusCode.OK, await Admission(member, refreshed));
        using var changed = operation switch
        {
            "disconnect" => await Send(owner, Path(community, "/disconnect"), new VoiceLeaseRequest(Guid.Parse(b.LeaseId))),
            "ban" => await Send(owner, $"/api/v1/communities/{community}/members/{person.Id}/ban", new { Banned = true }, "PUT"),
            _ => await Send(member, "/api/v1/account/logout"),
        };
        Assert.True(changed.IsSuccessStatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await Admission(member, b.Token)); Assert.Equal(HttpStatusCode.Unauthorized, await Admission(member, refreshed));
        await Reconcile(host, community);
        Assert.Contains(Guid.Parse(b.LeaseId), fake.Removed); Assert.Empty(fake.Deleted);
        Assert.Equal(new[] { a.Identity, c.Identity }, fake.Actual.Select(p => p.Identity));
        var state = (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!;
        Assert.Equal("Ready", state.Status); Assert.Equal(a.Generation, state.Generation); Assert.Equal(a.LeaseId, state.MyLeaseId);
        Assert.Equal(HttpStatusCode.OK, await Admission(owner, a.Token)); Assert.Equal(HttpStatusCode.OK, await Admission(peer, c.Token));
        if (operation == "disconnect")
        {
            Assert.Equal(HttpStatusCode.Conflict, (await Send(member, Path(community, "/join"), new JoinVoiceRequest(await db.VoiceGrantRequests.Where(r => r.LeaseId == Guid.Parse(b.LeaseId)).Select(r => r.ClientRequestId).SingleAsync()))).StatusCode);
            var next = await Grant(member, community); Assert.NotEqual(b.Identity, next.Identity); Assert.Equal(HttpStatusCode.OK, await Admission(member, next.Token));
        }
    }

    [Fact]
    public async Task AdmissionRejectsForeignOriginForgedAdministrativeWrongRoomAndChangedRights()
    {
        await using var host = Factory(new FakeVoice { Signed = true }, true); using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); await Register(member); var community = await Create(owner); await AddMember(owner, member, community); var grant = await Grant(member, community);
        Assert.Equal(HttpStatusCode.Forbidden, await Admission(member, grant.Token, null));
        Assert.Equal(HttpStatusCode.Forbidden, await Admission(member, grant.Token, "https://foreign.example"));
        Assert.Equal(HttpStatusCode.Unauthorized, await Admission(member, grant.Token[..^8] + "forged00"));
        foreach (var grants in new[] { new VideoGrants { RoomJoin = true, Room = "wrong_room", CanSubscribe = true }, new VideoGrants { RoomJoin = true, Room = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(grant.Token).Claims.Where(c => c.Type == "video").Select(c => System.Text.Json.JsonDocument.Parse(c.Value).RootElement.GetProperty("room").GetString()).Single(), RoomAdmin = true, CanSubscribe = true } })
        {
            var invalid = new AccessToken("test_key", Secret).WithIdentity(grant.Identity).WithExpiration(DateTime.UtcNow.AddMinutes(1)).WithGrants(grants).ToJwt();
            Assert.Equal(HttpStatusCode.Unauthorized, await Admission(member, invalid));
        }
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // Admission independently rechecks rights even before the reconciler has observed a policy change.
        var role = await db.CommunityRoles.SingleAsync(r => r.Id == Guid.Parse(community)); role.Grants &= ~ChannelAccess.SpeakVoice; await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, await Admission(member, grant.Token));
    }

    [Fact]
    public async Task ProtectedAdmissionRecoversAbandonedJoinAndFailedControlWithGenerationFallback()
    {
        var fake = new FakeVoice { Signed = true }; await using var host = Factory(fake, true); using var owner = host.CreateClient();
        await Register(owner); var community = await Create(owner); var grant = await Grant(owner, community);
        using (var scope = host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var room = await db.VoiceRooms.SingleAsync(r => r.ChannelId == Guid.Parse(community));
            room.AdmissionAttempt = Guid.NewGuid(); room.AdmissionDeadline = DateTimeOffset.UtcNow.AddSeconds(-1); await db.SaveChangesAsync();
        }
        fake.Fail = true; await Reconcile(host, community);
        var pending = (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!; Assert.Equal("Pending", pending.Status);
        Assert.Equal(HttpStatusCode.Unauthorized, await Admission(owner, grant.Token));
        fake.Fail = false; await Reconcile(host, community);
        var state = (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!; Assert.Equal("Ready", state.Status); Assert.Equal("2", state.Generation);
        Assert.Equal(HttpStatusCode.Unauthorized, await Admission(owner, grant.Token));
    }

    [Fact]
    public async Task NamedVoiceChannelsIsolateLeasesPermissionsTransitionsAndConfiguration()
    {
        var fake = new FakeVoice(); await using var host = Factory(fake); using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); await Register(member); var community = await Create(owner); await AddMember(owner, member, community);
        var id = Guid.Parse(community); var second = Guid.NewGuid();
        var p = (await owner.GetFromJsonAsync<AccessPolicy>($"/api/v1/communities/{community}/access"))!;
        var policy = p with { VoiceChannels = [.. p.VoiceChannels!, new(second, "Games", null)] };
        var request = new SaveAccessRequest(Guid.NewGuid(), policy);
        Assert.Equal(HttpStatusCode.OK, (await Send(owner, $"/api/v1/communities/{community}/access", request, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(owner, $"/api/v1/communities/{community}/access", request, "PUT")).StatusCode);
        var defaultGrant = await Grant(owner, community); var extra = Path(community, $"/channels/{second}");
        var joinRequest = new JoinVoiceRequest(Guid.NewGuid());
        using var joined = await Send(member, extra + "/join", joinRequest); Assert.Equal(HttpStatusCode.OK, joined.StatusCode);
        var secondGrant = (await joined.Content.ReadFromJsonAsync<VoiceJoinDto>())!;
        Assert.Equal(HttpStatusCode.Conflict, (await Send(member, Path(community, "/join"), joinRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(member, Path(community, "/leave"), new VoiceLeaseRequest(Guid.Parse(secondGrant.LeaseId)))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync(Path(community, $"/channels/{Guid.NewGuid()}"))).StatusCode);
        p = (await owner.GetFromJsonAsync<AccessPolicy>($"/api/v1/communities/{community}/access"))!;
        policy = p with { VoiceRules = [new(second, id, 0, ChannelAccess.ConnectVoice)] };
        Assert.Equal(HttpStatusCode.OK, (await Send(owner, $"/api/v1/communities/{community}/access", new SaveAccessRequest(Guid.NewGuid(), policy), "PUT")).StatusCode);
        using (var scope = host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal("Ready", (await db.VoiceRooms.SingleAsync(r => r.ChannelId == id)).Status);
            Assert.Equal("Pending", (await db.VoiceRooms.SingleAsync(r => r.ChannelId == second)).Status);
            Assert.True((await db.VoiceLeases.SingleAsync(l => l.Id == Guid.Parse(defaultGrant.LeaseId))).Active);
            await scope.ServiceProvider.GetRequiredService<VoiceReconciler>().ReconcileAsync(second, default);
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(member, extra + "/join", new JoinVoiceRequest(Guid.NewGuid()))).StatusCode);
        p = (await owner.GetFromJsonAsync<AccessPolicy>($"/api/v1/communities/{community}/access"))!;
        policy = p with { VoiceRules = [new(second, id, 0, ChannelAccess.View)] };
        Assert.Equal(HttpStatusCode.OK, (await Send(owner, $"/api/v1/communities/{community}/access", new SaveAccessRequest(Guid.NewGuid(), policy), "PUT")).StatusCode);
        var detail = (await member.GetFromJsonAsync<CommunityDetails>($"/api/v1/communities/{community}"))!;
        Assert.DoesNotContain(detail.VoiceChannels!, c => c.Id == second.ToString());
        Assert.Equal(HttpStatusCode.NotFound, (await member.GetAsync(extra)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.GetAsync($"/api/v1/communities/{community}/rights?kind=voice&channelId={second}")).StatusCode);
        var exported = (await owner.GetFromJsonAsync<CommunityConfiguration>($"/api/v1/communities/{community}/configuration"))!;
        Assert.Equal(2, exported.Version); Assert.Equal(2, exported.VoiceChannels!.Length);
        using var restored = await Send(owner, "/api/v1/communities/configuration/restore", new { ClientRequestId = Guid.NewGuid(), Name = "Voice configuration copy", Configuration = exported });
        Assert.Equal(HttpStatusCode.Created, restored.StatusCode);
        var copy = (await restored.Content.ReadFromJsonAsync<ConfigurationRestored>())!;
        var copied = (await owner.GetFromJsonAsync<AccessPolicy>($"/api/v1/communities/{copy.CommunityId}/access"))!;
        Assert.Equal(2, copied.VoiceChannels!.Length); Assert.DoesNotContain(copied.VoiceChannels, c => c.Id == second);
        Assert.Equal(copied.VoiceChannels.Single(c => c.Name == "Games").Id, Assert.Single(copied.VoiceRules!).ResourceId);
        // Historical v1 files still restore a default room, without importing live leases.
        var old = exported with { Version = 1, VoiceChannels = null, VoiceRules = [] };
        using var legacy = await Send(owner, "/api/v1/communities/configuration/restore", new { ClientRequestId = Guid.NewGuid(), Name = "Legacy voice copy", Configuration = old });
        Assert.Equal(HttpStatusCode.Created, legacy.StatusCode);
    }
}
