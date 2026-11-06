using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Communities;
using App.Api.Features.DirectMessages;
using App.Api.Features.Voice;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace App.IntegrationTests;

public sealed partial class VoiceTests
{
    [Fact]
    public async Task PersonalCallSetupDoesNotWaitForMembershipForeignKeyReaders()
    {
        await using var host = Factory(new FakeVoice { Signed = true }, true); using var caller = host.CreateClient(); using var recipient = host.CreateClient();
        var owner = await Register(caller); var other = await Register(recipient); var conversation = await Conversation(caller, other.Id);
        await using var connection = new NpgsqlConnection(storage.Connection); await connection.OpenAsync(); await using var tx = await connection.BeginTransactionAsync();
        // A membership insert takes this row lock while its transaction is open.
        await using var command = new NpgsqlCommand("SELECT 1 FROM \"AspNetUsers\" WHERE \"Id\" = @id FOR KEY SHARE", connection, tx);
        command.Parameters.AddWithValue("id", Guid.Parse(owner.Id)); await command.ExecuteScalarAsync();
        var pending = Send(caller, $"/api/v1/direct-calls/conversation/{conversation}", new StartCallRequest(Guid.NewGuid()));
        try { using var response = await pending.WaitAsync(TimeSpan.FromSeconds(3)); Assert.Equal(HttpStatusCode.OK, response.StatusCode); }
        finally { await tx.RollbackAsync(); if (!pending.IsCompleted) { using var completed = await pending; } }
    }

    private static async Task<string> Conversation(HttpClient caller, string other)
    {
        using var result = await Send(caller, "/api/v1/direct-messages", new StartDirectRequest(Guid.NewGuid(), Guid.Parse(other)));
        Assert.Equal(HttpStatusCode.Created, result.StatusCode); return (await result.Content.ReadFromJsonAsync<DirectConversationDto>())!.Id;
    }
    private static async Task<DirectCallDto> Ring(HttpClient caller, string conversation, Guid? request = null)
    {
        using var result = await Send(caller, $"/api/v1/direct-calls/conversation/{conversation}", new StartCallRequest(request ?? Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.OK, result.StatusCode); return (await result.Content.ReadFromJsonAsync<DirectCallDto>())!;
    }
    private static string CallPath(DirectCallDto call, string suffix = "") => $"/api/v1/direct-calls/{call.Id}{suffix}";
    private static async Task<VoiceJoinDto> CallGrant(HttpClient client, DirectCallDto call)
    {
        using var result = await Send(client, CallPath(call, "/join"), new JoinVoiceRequest(Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.OK, result.StatusCode); return (await result.Content.ReadFromJsonAsync<VoiceJoinDto>())!;
    }
    private static async Task<HttpStatusCode> CallAdmission(HttpClient client, string token, string? origin = "http://localhost")
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/livekit/direct/rtc/validate?access_token=" + Uri.EscapeDataString(token));
        if (origin != null) request.Headers.Add("Origin", origin); using var result = await client.SendAsync(request); return result.StatusCode;
    }
    private static async Task ReconcileCall(FoundationFactory host, string id)
    {
        using var scope = host.Services.CreateScope(); await scope.ServiceProvider.GetRequiredService<DirectCallService>().ReconcileAsync(Guid.Parse(id), default);
    }
    [Fact]
    public async Task PersonalCallRequiresAcceptanceAndKeepsParticipantSessionAndTokenBoundaries()
    {
        var fake = new FakeVoice { Signed = true }; await using var host = Factory(fake, true);
        using var caller = host.CreateClient(); using var recipient = host.CreateClient(); using var stranger = host.CreateClient(); using var anonymous = host.CreateClient();
        await Register(caller); var person = await Register(recipient); await Register(stranger); var conversation = await Conversation(caller, person.Id);
        var request = Guid.NewGuid(); var call = await Ring(caller, conversation, request); var retry = await Ring(caller, conversation, request);
        Assert.Equal(call, retry); Assert.Equal("Ringing", call.Status); Assert.False(call.CanJoin);
        using var beforeAnswer = await Send(caller, CallPath(call, "/join"), new JoinVoiceRequest(Guid.NewGuid())); Assert.Equal(HttpStatusCode.NotFound, beforeAnswer.StatusCode);
        using var thirdParty = await stranger.GetAsync(CallPath(call)); Assert.Equal(HttpStatusCode.NotFound, thirdParty.StatusCode);
        using var privateStart = await Send(stranger, $"/api/v1/direct-calls/conversation/{conversation}", new StartCallRequest(Guid.NewGuid())); Assert.Equal(HttpStatusCode.NotFound, privateStart.StatusCode);
        using var notSignedIn = await anonymous.GetAsync("/api/v1/direct-calls"); Assert.Equal(HttpStatusCode.Unauthorized, notSignedIn.StatusCode);
        using var selfAnswer = await Send(caller, CallPath(call, "/accept")); Assert.Equal(HttpStatusCode.Forbidden, selfAnswer.StatusCode);
        var answers = await Task.WhenAll(Send(recipient, CallPath(call, "/accept")), Send(recipient, CallPath(call, "/accept")));
        foreach (var answer in answers) { Assert.Equal(HttpStatusCode.OK, answer.StatusCode); answer.Dispose(); }
        var grant = await CallGrant(caller, call); var other = await CallGrant(recipient, call); var repeatedGrant = await CallGrant(caller, call);
        Assert.Equal(grant.LeaseId, repeatedGrant.LeaseId); Assert.NotEqual(grant.Identity, other.Identity); Assert.EndsWith("/direct", grant.Url);
        Assert.True(grant.CanSpeak && grant.CanShareScreen && grant.CanUseCamera);
        Assert.Equal(HttpStatusCode.OK, await CallAdmission(caller, grant.Token)); Assert.Equal(HttpStatusCode.Forbidden, await CallAdmission(caller, grant.Token, null));
        Assert.Equal(HttpStatusCode.Unauthorized, await Admission(caller, grant.Token));
        using var unrelatedGrant = await Send(stranger, CallPath(call, "/join"), new JoinVoiceRequest(Guid.NewGuid())); Assert.Equal(HttpStatusCode.NotFound, unrelatedGrant.StatusCode);
        using var finish = await Send(recipient, CallPath(call, "/end")); Assert.Equal(HttpStatusCode.OK, finish.StatusCode);
        using var repeatedFinish = await Send(caller, CallPath(call, "/end")); Assert.Equal(HttpStatusCode.OK, repeatedFinish.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await CallAdmission(caller, grant.Token)); Assert.Equal(HttpStatusCode.Unauthorized, await CallAdmission(recipient, other.Token));
        using var afterEnd = await Send(caller, CallPath(call, "/join"), new JoinVoiceRequest(Guid.NewGuid())); Assert.Equal(HttpStatusCode.NotFound, afterEnd.StatusCode);
        fake.Fail = true; await Assert.ThrowsAsync<VoiceGatewayException>(() => ReconcileCall(host, call.Id));
        using (var scope = host.Services.CreateScope()) { var row = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Set<DirectCall>().SingleAsync(c => c.Id == Guid.Parse(call.Id)); Assert.Equal("Ended", row.Status); Assert.False(row.Cleaned); }
        fake.Fail = false; await ReconcileCall(host, call.Id); Assert.Contains(new VoiceRoom(Guid.Parse(call.Id), 1).Name, fake.Deleted);
        using (var scope = host.Services.CreateScope()) Assert.True(await scope.ServiceProvider.GetRequiredService<AppDbContext>().Set<DirectCall>().Where(c => c.Id == Guid.Parse(call.Id)).Select(c => c.Cleaned).SingleAsync());
    }

    [Fact]
    public async Task PersonalCallAndCommunityVoiceCannotReserveTheSameAccountConcurrently()
    {
        await using var host = Factory(new FakeVoice { Signed = true }, true); using var caller = host.CreateClient(); using var recipient = host.CreateClient();
        await Register(caller); var person = await Register(recipient); var conversation = await Conversation(caller, person.Id); var community = await Create(caller);
        var lease = await Grant(caller, community);
        using var busy = await Send(caller, $"/api/v1/direct-calls/conversation/{conversation}", new StartCallRequest(Guid.NewGuid())); Assert.Equal(HttpStatusCode.Conflict, busy.StatusCode);
        using var leave = await Send(caller, Path(community, "/leave"), new VoiceLeaseRequest(Guid.Parse(lease.LeaseId))); Assert.Equal(HttpStatusCode.OK, leave.StatusCode);
        var call = await Ring(caller, conversation);
        using var communityJoin = await Send(caller, Path(community, "/join"), new JoinVoiceRequest(Guid.NewGuid())); Assert.Equal(HttpStatusCode.Conflict, communityJoin.StatusCode);
        using var outgoing = await Send(recipient, $"/api/v1/direct-calls/conversation/{conversation}", new StartCallRequest(Guid.NewGuid())); Assert.Equal(HttpStatusCode.Conflict, outgoing.StatusCode);
        using var answer = await Send(recipient, CallPath(call, "/accept")); Assert.Equal(HttpStatusCode.OK, answer.StatusCode);
        using var after = await Send(caller, Path(community, "/join"), new JoinVoiceRequest(Guid.NewGuid())); Assert.Equal(HttpStatusCode.Conflict, after.StatusCode);
    }

    [Fact]
    public async Task PersonalCallBlockingAndLogoutInvalidateOldAndRefreshedTokens()
    {
        var fake = new FakeVoice { Signed = true }; await using var host = Factory(fake, true); using var caller = host.CreateClient(); using var recipient = host.CreateClient();
        var owner = await Register(caller); var person = await Register(recipient); var conversation = await Conversation(caller, person.Id); var call = await Ring(caller, conversation);
        using var answer = await Send(recipient, CallPath(call, "/accept")); Assert.Equal(HttpStatusCode.OK, answer.StatusCode);
        var grant = await CallGrant(caller, call); var other = await CallGrant(recipient, call);
        var refreshed = new LiveKitGateway(new HttpClient(), new Uri("http://127.0.0.1:7880"), "test_key", Secret).CreateGrant(new(Guid.Parse(call.Id), 1), Guid.Parse(grant.LeaseId), true, true, true);
        Assert.Equal(HttpStatusCode.OK, await CallAdmission(caller, refreshed.Token));
        using var block = await Send(recipient, $"/api/v1/direct-messages/{conversation}/block", new BlockDirectRequest(Guid.NewGuid(), true), "PUT"); Assert.Equal(HttpStatusCode.OK, block.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await CallAdmission(caller, refreshed.Token)); Assert.Equal(HttpStatusCode.Unauthorized, await CallAdmission(recipient, other.Token));
        await ReconcileCall(host, call.Id);
        using var blockedRing = await Send(caller, $"/api/v1/direct-calls/conversation/{conversation}", new StartCallRequest(Guid.NewGuid())); Assert.Equal(HttpStatusCode.Forbidden, blockedRing.StatusCode);
        using var unblock = await Send(recipient, $"/api/v1/direct-messages/{conversation}/block", new BlockDirectRequest(Guid.NewGuid(), false), "PUT"); Assert.Equal(HttpStatusCode.OK, unblock.StatusCode);
        var next = await Ring(caller, conversation); Assert.NotEqual(call.Id, next.Id);
        using var nextAnswer = await Send(recipient, CallPath(next, "/accept")); Assert.Equal(HttpStatusCode.OK, nextAnswer.StatusCode); var active = await CallGrant(caller, next);
        using var logout = await Send(recipient, "/api/v1/account/logout"); Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await CallAdmission(caller, active.Token)); await ReconcileCall(host, next.Id);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PersonalCallRingingAndHeartbeatTimeoutsCannotBeRevived(bool accepted)
    {
        await using var host = Factory(new FakeVoice { Signed = true }, true); using var caller = host.CreateClient(); using var recipient = host.CreateClient();
        await Register(caller); var person = await Register(recipient); var conversation = await Conversation(caller, person.Id); var call = await Ring(caller, conversation);
        if (accepted) { using var answer = await Send(recipient, CallPath(call, "/accept")); Assert.Equal(HttpStatusCode.OK, answer.StatusCode); }
        using (var scope = host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            if (accepted) await db.Set<DirectCallMember>().Where(m => m.CallId == Guid.Parse(call.Id)).ExecuteUpdateAsync(m => m.SetProperty(x => x.ExpiresAt, DateTimeOffset.UtcNow.AddSeconds(-1)));
            else await db.Set<DirectCall>().Where(c => c.Id == Guid.Parse(call.Id)).ExecuteUpdateAsync(c => c.SetProperty(x => x.RingUntil, DateTimeOffset.UtcNow.AddSeconds(-1)));
        }
        var ended = (await caller.GetFromJsonAsync<DirectCallDto>(CallPath(call)))!; Assert.Equal("Ended", ended.Status);
        using var late = await Send(recipient, CallPath(call, "/accept")); Assert.Equal(HttpStatusCode.NotFound, late.StatusCode);
        Assert.DoesNotContain((await recipient.GetFromJsonAsync<DirectCallDto[]>("/api/v1/direct-calls"))!, c => c.Id == call.Id);
    }

    [Fact]
    public async Task PersonalCallRejectsAnotherSessionAndEscalatedOrUnrelatedMediaGrants()
    {
        await using var host = Factory(new FakeVoice { Signed = true }, true); using var caller = host.CreateClient(); using var recipient = host.CreateClient(); using var second = host.CreateClient();
        await Register(caller); var person = await Register(recipient); var conversation = await Conversation(caller, person.Id); var call = await Ring(caller, conversation);
        using var answer = await Send(recipient, CallPath(call, "/accept")); Assert.Equal(HttpStatusCode.OK, answer.StatusCode);
        using var login = await Send(second, "/api/v1/account/login", new { person.Email, Password = "Synthetic voice passphrase 42" }); Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        using var moved = await Send(second, CallPath(call, "/accept")); Assert.Equal(HttpStatusCode.Conflict, moved.StatusCode);
        using var stolen = await Send(second, CallPath(call, "/join"), new JoinVoiceRequest(Guid.NewGuid())); Assert.Equal(HttpStatusCode.NotFound, stolen.StatusCode);
        Assert.False((await second.GetFromJsonAsync<DirectCallDto>(CallPath(call)))!.CanJoin);
        var grant = await CallGrant(caller, call);
        var elevated = new Livekit.Server.Sdk.Dotnet.AccessToken("test_key", Secret).WithIdentity(grant.Identity).WithExpiration(DateTime.UtcNow.AddMinutes(1))
            .WithGrants(new Livekit.Server.Sdk.Dotnet.VideoGrants { RoomJoin = true, Room = new VoiceRoom(Guid.Parse(call.Id), 1).Name, CanSubscribe = true, CanPublish = true, RoomAdmin = true,
                CanPublishSources = ["microphone", "camera", "screen_share", "screen_share_audio"] }).ToJwt();
        Assert.Equal(HttpStatusCode.Unauthorized, await CallAdmission(caller, elevated));
        using var http = new HttpClient(); var gateway = new LiveKitGateway(http, new Uri("http://127.0.0.1:7880"), "test_key", Secret);
        var wrongRoom = gateway.CreateGrant(new(Guid.NewGuid(), 1), Guid.Parse(grant.LeaseId), true, true, true);
        Assert.Equal(HttpStatusCode.Unauthorized, await CallAdmission(caller, wrongRoom.Token));
        var excessSource = gateway.CreateGrant(new(Guid.Parse(call.Id), 1), Guid.Parse(grant.LeaseId), true, false, true);
        Assert.Equal(HttpStatusCode.Unauthorized, await CallAdmission(caller, excessSource.Token));
        var unknownIdentity = gateway.CreateGrant(new(Guid.Parse(call.Id), 1), Guid.NewGuid(), true, true, true);
        Assert.Equal(HttpStatusCode.Unauthorized, await CallAdmission(caller, unknownIdentity.Token));
    }
}
