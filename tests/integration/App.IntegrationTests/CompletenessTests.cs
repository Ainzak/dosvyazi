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
public sealed class CompletenessTests(AccountsDatabase database) : IClassFixture<AccountsDatabase>
{
    private FoundationFactory Factory() => new(connection: database.Connection, permitLimit: 120);
    private static async Task<HttpResponseMessage> Command(HttpClient client, string path, object body, string method = "POST")
    {
        var csrf = (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!;
        using var request = new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(body) }; request.Headers.Add("X-CSRF-TOKEN", csrf.RequestToken);
        return await client.SendAsync(request);
    }
    private static async Task<UserProfile> Register(HttpClient client)
    {
        using var response = await Command(client, "/api/v1/account/register", new { Email = $"m5-{Guid.NewGuid():N}@example.test", Password = "Synthetic completion passphrase 42", DisplayName = "M5 member" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode); return (await response.Content.ReadFromJsonAsync<UserProfile>())!;
    }
    private static async Task<CommunityDetails> Create(HttpClient owner)
    {
        using var response = await Command(owner, "/api/v1/communities", new { ClientRequestId = Guid.NewGuid(), Name = "M5 community" });
        return (await response.Content.ReadFromJsonAsync<CommunityDetails>())!;
    }
    private static string Root(CommunityDetails c) => $"/api/v1/communities/{c.Id}/channels/{c.Channels[0].Id}";
    private static async Task Join(HttpClient owner, HttpClient member, CommunityDetails c)
    {
        using var response = await Command(owner, $"/api/v1/communities/{c.Id}/invites", new { ClientRequestId = Guid.NewGuid(), LifetimeHours = 24, MaxUses = 10 });
        var invite = (await response.Content.ReadFromJsonAsync<CreatedInvite>())!;
        Assert.Equal(HttpStatusCode.OK, (await Command(member, "/api/v1/communities/join", new { invite.Code })).StatusCode);
    }
    private static async Task<MessageDto> Send(HttpClient client, CommunityDetails c, string text)
    {
        using var response = await Command(client, Root(c) + "/messages", new { ClientMessageId = Guid.NewGuid(), Content = text });
        return (await response.Content.ReadFromJsonAsync<MessageDto>())!;
    }
    [Fact]
    public async Task ReactionsArePersonalizedConcurrentAndPayloadBoundWithoutRevivingOldIntent()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); await Register(member); var c = await Create(owner); await Join(owner, member, c); var message = await Send(owner, c, "Reactions");
        var path = Root(c) + $"/messages/{message.Id}/reaction"; var id = Guid.NewGuid(); var payload = new ReactionRequest(id, "👍", true);
        var responses = await Task.WhenAll(Command(owner, path, payload, "PUT"), Command(owner, path, payload, "PUT"));
        foreach (var r in responses) { Assert.Equal(HttpStatusCode.OK, r.StatusCode); var data = (await r.Content.ReadFromJsonAsync<MessageDto>())!; Assert.Equal("2", data.Version); Assert.Equal(1, data.Reactions!.Single().Count); Assert.True(data.Reactions!.Single().Mine); r.Dispose(); }
        Assert.False((await member.GetFromJsonAsync<MessageSnapshot>(Root(c) + "/messages"))!.Messages.Single().Reactions!.Single().Mine);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner, path, payload with { Active = false }, "PUT")).StatusCode);
        await Command(member, path, new ReactionRequest(Guid.NewGuid(), "👍", true), "PUT");
        Assert.Equal(2, (await owner.GetFromJsonAsync<MessageSnapshot>(Root(c) + "/messages"))!.Messages.Single().Reactions!.Single().Count);
        await Command(owner, path, new ReactionRequest(Guid.NewGuid(), "👍", false), "PUT");
        await Command(owner, path, payload, "PUT");
        Assert.False((await owner.GetFromJsonAsync<MessageSnapshot>(Root(c) + "/messages"))!.Messages.Single().Reactions!.Single().Mine);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(owner, path, new ReactionRequest(Guid.NewGuid(), "not-emoji", true), "PUT")).StatusCode);
        var events = (await member.GetFromJsonAsync<CatchUpPage>(Root(c) + "/events?after=0"))!.Events;
        Assert.True(events.Last().Payload!.Reactions!.Single().Mine);
    }
    [Fact]
    public async Task SearchAndReadStateRespectEditsDeletionAndMonotonicPositions()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); await Register(member); var c = await Create(owner); await Join(owner, member, c);
        var first = await Send(owner, c, "Hello banana Привет команда"); var second = await Send(owner, c, "Second banana");
        Assert.Equal(2, (await member.GetFromJsonAsync<ReadStateDto>(Root(c) + "/read-state"))!.Unread);
        await Command(member, Root(c) + "/read-state", new ReadStateRequest(second.Sequence), "PUT");
        await Command(member, Root(c) + "/read-state", new ReadStateRequest(first.Sequence), "PUT");
        var read = (await member.GetFromJsonAsync<ReadStateDto>(Root(c) + "/read-state"))!; Assert.Equal(second.Sequence, read.Sequence); Assert.Equal(0, read.Unread);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(member, Root(c) + "/read-state", new ReadStateRequest("999"), "PUT")).StatusCode);
        var russian = (await member.GetFromJsonAsync<SearchPage>(Root(c) + "/search?query=" + Uri.EscapeDataString("Привет")))!; Assert.Equal(first.Id, russian.Messages.Single().Id);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await member.GetAsync(Root(c) + "/search?query=" + Uri.EscapeDataString("bad\0query"))).StatusCode);
        await Command(owner, Root(c) + $"/messages/{first.Id}", new EditMessageRequest(Guid.NewGuid(), "1", "Changed apple"), "PUT");
        Assert.Single((await member.GetFromJsonAsync<SearchPage>(Root(c) + "/search?query=banana"))!.Messages);
        await Command(owner, Root(c) + $"/messages/{second.Id}/delete", new DeleteMessageRequest(Guid.NewGuid(), "1"));
        Assert.Empty((await member.GetFromJsonAsync<SearchPage>(Root(c) + "/search?query=banana"))!.Messages);
        Assert.Equal(0, (await owner.GetFromJsonAsync<ReadStateDto>(Root(c) + "/read-state"))!.Unread);
    }
    [Fact]
    public async Task PrivateAndReadOnlyPermissionsProtectAllCompletenessEndpoints()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var member = host.CreateClient(); using var outsider = host.CreateClient();
        await Register(owner); await Register(member); await Register(outsider); var c = await Create(owner); await Join(owner, member, c); var m = await Send(owner, c, "Private search token");
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(Root(c) + "/search?query=token")).StatusCode);
        var policy = (await owner.GetFromJsonAsync<AccessPolicy>($"/api/v1/communities/{c.Id}/access"))!;
        await Command(owner, $"/api/v1/communities/{c.Id}/access", new SaveAccessRequest(Guid.NewGuid(), policy with { Roles = policy.Roles.Select(r => r with { Grants = ChannelAccess.View }).ToArray() }), "PUT");
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(member, Root(c) + $"/messages/{m.Id}/reaction", new ReactionRequest(Guid.NewGuid(), "👍", true), "PUT")).StatusCode);
        policy = (await owner.GetFromJsonAsync<AccessPolicy>($"/api/v1/communities/{c.Id}/access"))!;
        await Command(owner, $"/api/v1/communities/{c.Id}/access", new SaveAccessRequest(Guid.NewGuid(), policy with { Roles = policy.Roles.Select(r => r with { Grants = 0 }).ToArray() }), "PUT");
        foreach (var suffix in new[] { "/search?query=token", "/read-state" }) Assert.Equal(HttpStatusCode.NotFound, (await member.GetAsync(Root(c) + suffix)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(member, Root(c) + "/read-state", new ReadStateRequest("0"), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(member, Root(c) + $"/messages/{m.Id}/reaction", new ReactionRequest(Guid.NewGuid(), "👍", true), "PUT")).StatusCode);
    }
    [Fact]
    public async Task SearchPaginationIsBoundedAndReadPositionsStayMonotonicUnderConcurrency()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); await Register(owner); var c = await Create(owner);
        for (var i = 0; i < 30; i++) await Send(owner, c, $"Paginationword result {i}");
        var first = (await owner.GetFromJsonAsync<SearchPage>(Root(c) + "/search?query=Paginationword"))!;
        Assert.Equal(25, first.Messages.Length); Assert.True(first.HasMore);
        var next = (await owner.GetFromJsonAsync<SearchPage>(Root(c) + "/search?query=Paginationword&before=" + first.Before))!;
        Assert.Equal(5, next.Messages.Length); Assert.False(next.HasMore); Assert.Empty(first.Messages.Select(m => m.Id).Intersect(next.Messages.Select(m => m.Id)));
        var responses = await Task.WhenAll(Command(owner, Root(c) + "/read-state", new ReadStateRequest("30"), "PUT"), Command(owner, Root(c) + "/read-state", new ReadStateRequest("5"), "PUT"));
        foreach (var response in responses) { Assert.Equal(HttpStatusCode.OK, response.StatusCode); response.Dispose(); }
        Assert.Equal("30", (await owner.GetFromJsonAsync<ReadStateDto>(Root(c) + "/read-state"))!.Sequence);
    }
    [Fact]
    public async Task ProfilesExposeOnlyApprovedDetailsToSignedInUsersAndOnlySelfMayEdit()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var stranger = host.CreateClient(); using var anonymous = host.CreateClient();
        var user = await Register(owner); await Register(stranger);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/v1/profiles/{user.Id}")).StatusCode);
        var payload = new ProfileDetailsRequest("<script>plain profile</script>", "Music", "Chess", "Casual team");
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync("/api/v1/profiles/me", payload)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(owner, "/api/v1/profiles/me", payload, "PUT")).StatusCode);
        var response = await stranger.GetAsync($"/api/v1/profiles/{user.Id}"); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.DoesNotContain(user.Email, await response.Content.ReadAsStringAsync());
        Assert.Equal(payload.Games, (await response.Content.ReadFromJsonAsync<PublicProfileDto>())!.Games);
        await Command(stranger, "/api/v1/profiles/me", payload with { Games = "Other game" }, "PUT");
        Assert.Equal("Chess", (await owner.GetFromJsonAsync<PublicProfileDto>($"/api/v1/profiles/{user.Id}"))!.Games);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(owner, "/api/v1/profiles/me", payload with { About = "bad\0" }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Command(owner, "/api/v1/profiles/me", payload with { Games = new string('x',501) }, "PUT")).StatusCode);
        var updates = await Task.WhenAll(Command(owner, "/api/v1/profiles/me", payload with { Interests = "Updated interests" }, "PUT"), Command(owner, "/api/v1/account/me", new UpdateProfileRequest("Updated member"), "PUT"));
        foreach (var update in updates) { Assert.Equal(HttpStatusCode.OK, update.StatusCode); update.Dispose(); }
        var combined = (await owner.GetFromJsonAsync<PublicProfileDto>($"/api/v1/profiles/{user.Id}"))!;
        Assert.Equal("Updated interests", combined.Interests); Assert.Equal("Updated member", combined.DisplayName);
    }
    private static async Task<HttpResponseMessage> UploadEmoji(HttpClient client, CommunityDetails c, Guid id, string name = "tiny", byte[]? bytes = null)
    {
        var csrf = (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!;
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/communities/{c.Id}/emoji"); request.Headers.Add("X-CSRF-TOKEN", csrf.RequestToken);
        var form = new MultipartFormDataContent(); form.Add(new StringContent(id.ToString()), "clientRequestId"); form.Add(new StringContent(name), "name");
        form.Add(new ByteArrayContent(bytes ?? Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ2sAAAAASUVORK5CYII=")), "file", "tiny.png"); request.Content = form; return await client.SendAsync(request);
    }
    [Fact]
    public async Task CustomEmojiAreCommunityScopedBoundedIdempotentAndDeletionPreservesRemovability()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var member = host.CreateClient(); using var outsider = host.CreateClient();
        await Register(owner); await Register(member); await Register(outsider); var c = await Create(owner); await Join(owner, member, c); var request = Guid.NewGuid();
        using var created = await UploadEmoji(owner,c,request); Assert.Equal(HttpStatusCode.OK, created.StatusCode); var emoji = (await created.Content.ReadFromJsonAsync<EmojiDto>())!;
        using var retry = await UploadEmoji(owner,c,request); Assert.Equal(emoji, await retry.Content.ReadFromJsonAsync<EmojiDto>());
        Assert.Equal(HttpStatusCode.Forbidden, (await UploadEmoji(member,c,Guid.NewGuid(),"other")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/v1/communities/{c.Id}/emoji/{emoji.Id}/image")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.GetAsync($"/api/v1/communities/{c.Id}/emoji/{emoji.Id}/image")).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await UploadEmoji(owner,c,Guid.NewGuid(),bytes: "fake png"u8.ToArray())).StatusCode);
        var m = await Send(member,c,"Custom emoji"); var path = Root(c) + $"/messages/{m.Id}/reaction";
        Assert.Equal(HttpStatusCode.OK,(await Command(member,path,new ReactionRequest(Guid.NewGuid(),"custom:"+emoji.Id,true),"PUT")).StatusCode);
        var other = await Create(owner); var otherMessage = await Send(owner,other,"Other");
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await Command(owner,Root(other)+$"/messages/{otherMessage.Id}/reaction",new ReactionRequest(Guid.NewGuid(),"custom:"+emoji.Id,true),"PUT")).StatusCode);
        await Command(owner,$"/api/v1/communities/{c.Id}/emoji/{emoji.Id}/delete",new {});
        Assert.Equal(HttpStatusCode.Conflict, (await UploadEmoji(owner,c,Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await member.GetAsync($"/api/v1/communities/{c.Id}/emoji/{emoji.Id}/image")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await Command(member,path,new ReactionRequest(Guid.NewGuid(),"custom:"+emoji.Id,false),"PUT")).StatusCode);
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); await AttachmentCleanup.PurgeAsync(db,scope.ServiceProvider.GetRequiredService<AttachmentStore>(),default);
        Assert.True((await db.CommunityEmojis.SingleAsync(e=>e.Id==Guid.Parse(emoji.Id))).Purged);
    }
}
