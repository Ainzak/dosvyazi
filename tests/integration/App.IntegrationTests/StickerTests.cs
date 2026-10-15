using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.DirectMessages;
using App.Api.Features.Messages;
using App.Api.Features.Stickers;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace App.IntegrationTests;

[Trait("Category", "PostgreSQL")]
public sealed class StickerTests(AccountsDatabase storage) : IClassFixture<AccountsDatabase>
{
    private const string Root = "/api/v1/sticker-packs";
    private FoundationFactory Factory() => new(connection: storage.Connection, permitLimit: 120);
    private static async Task<HttpResponseMessage> Command(HttpClient client, string path, object? body = null, string method = "POST")
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        request.Headers.Add("X-CSRF-TOKEN", (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!.RequestToken);
        if (body is not null) request.Content = JsonContent.Create(body); return await client.SendAsync(request);
    }
    private static async Task<UserProfile> Register(HttpClient client)
    {
        using var response = await Command(client, "/api/v1/account/register", new { Email = $"sticker-{Guid.NewGuid():N}@example.test", Password = "Synthetic sticker tests 42", DisplayName = "Sticker tester" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode); return (await response.Content.ReadFromJsonAsync<UserProfile>())!;
    }
    private static async Task<StickerPackDto> Create(HttpClient client)
    {
        using var response = await Command(client, Root, new CreatePackRequest(Guid.NewGuid(), "pack-" + Guid.NewGuid().ToString("N")[..20], "Synthetic pack"));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode); return (await response.Content.ReadFromJsonAsync<StickerPackDto>())!;
    }
    private static async Task<HttpResponseMessage> Upload(HttpClient client, string name, Guid id, byte[]? bytes = null, bool csrf = true)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, Root + $"/{name}/stickers");
        if (csrf) request.Headers.Add("X-CSRF-TOKEN", (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!.RequestToken);
        var form = new MultipartFormDataContent(); form.Add(new StringContent(id.ToString()), "clientRequestId"); form.Add(new StringContent("Animated greeting"), "label");
        form.Add(new ByteArrayContent(bytes ?? GifMediaTests.Animated()), "file", "greeting.gif"); request.Content = form; return await client.SendAsync(request);
    }
    [Fact]
    public async Task UniqueNamesPayloadBoundUploadsAndSavedLibrariesFollowOwnership()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var other = host.CreateClient(); using var anonymous = host.CreateClient();
        await Register(owner); await Register(other); var name = "race-" + Guid.NewGuid().ToString("N")[..20];
        var request = new CreatePackRequest(Guid.NewGuid(), name, "Unique pack");
        var race = await Task.WhenAll(Command(owner, Root, request), Command(other, Root, request));
        Assert.Single(race, r => r.StatusCode == HttpStatusCode.Created); Assert.Single(race, r => r.StatusCode == HttpStatusCode.Conflict); foreach (var response in race) response.Dispose();
        var pack = await Create(owner); var id = Guid.NewGuid();
        var replies = await Task.WhenAll(Upload(owner, pack.Name, id), Upload(owner, pack.Name, id));
        Assert.All(replies, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode)); var asset = (await replies[0].Content.ReadFromJsonAsync<StickerAssetDto>())!;
        Assert.Equal(asset, await replies[1].Content.ReadFromJsonAsync<StickerAssetDto>()); foreach (var response in replies) response.Dispose();
        Assert.Equal(HttpStatusCode.Conflict, (await Upload(owner, pack.Name, id, [.. GifMediaTests.Animated()[..^1], 0x21, 0xfe, 0, 0x3b])).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Upload(owner, pack.Name, Guid.NewGuid(), "<svg/>"u8.ToArray())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Upload(other, pack.Name, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Upload(owner, pack.Name, Guid.NewGuid(), csrf: false)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Root + $"/{pack.Name}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Root + $"/{pack.Name}/stickers/{asset.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await other.GetAsync(Root + $"/{pack.Name.ToUpperInvariant()}")).StatusCode);
        Assert.DoesNotContain((await other.GetFromJsonAsync<StickerPackDto[]>(Root))!, p => p.Id == pack.Id);
        Assert.Equal(HttpStatusCode.OK, (await Command(other, Root + $"/{pack.Name}/saved", new SavePackRequest(true), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(other, Root + $"/{pack.Name}/saved", new SavePackRequest(true), "PUT")).StatusCode);
        Assert.Single((await other.GetFromJsonAsync<StickerPackDto[]>(Root))!, p => p.Id == pack.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(other, Root + $"/{pack.Name}/retire")).StatusCode);
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // Built-in metadata is operator-owned; no client create/update parameter may request it.
        db.StickerPacks.Add(new() { Id = Guid.NewGuid(), BuiltIn = true, Name = "builtin-" + Guid.NewGuid().ToString("N")[..16], Title = "Synthetic operator pack", CreatedAt = DateTimeOffset.UtcNow }); await db.SaveChangesAsync();
        Assert.Contains((await other.GetFromJsonAsync<StickerPackDto[]>(Root))!, p => p.BuiltIn && !p.Mine);
    }
    [Fact]
    public async Task SentStickersStayPrivateAndRetryAfterSourceRetirementWithoutLosingTheirCopy()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var peer = host.CreateClient(); using var outsider = host.CreateClient();
        await Register(owner); var recipient = await Register(peer); await Register(outsider); var pack = await Create(owner);
        using var uploaded = await Upload(owner, pack.Name, Guid.NewGuid()); var asset = (await uploaded.Content.ReadFromJsonAsync<StickerAssetDto>())!;
        using var started = await Command(owner, "/api/v1/direct-messages", new StartDirectRequest(Guid.NewGuid(), Guid.Parse(recipient.Id))); var conversation = (await started.Content.ReadFromJsonAsync<DirectConversationDto>())!;
        var root = $"/api/v1/direct-messages/{conversation.Id}"; var request = new SendStickerRequest(Guid.NewGuid(), Guid.Parse(asset.Id), "");
        using var sent = await Command(owner, root + "/stickers", request); Assert.Equal(HttpStatusCode.Created, sent.StatusCode); var message = (await sent.Content.ReadFromJsonAsync<DirectMessageDto>())!;
        Assert.Equal("Sticker", message.Attachment!.Kind); Assert.Equal(pack.Name, message.Attachment.StickerPackName);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(root + $"/attachments/{message.Attachment.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(outsider, root + "/stickers", request)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(peer, root + "/block", new BlockDirectRequest(Guid.NewGuid(), true), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(owner, root + "/stickers", request with { ClientMessageId = Guid.NewGuid() })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(peer, root + "/block", new BlockDirectRequest(Guid.NewGuid(), false), "PUT")).StatusCode);
        using var created = await Command(owner, "/api/v1/communities", new { ClientRequestId = Guid.NewGuid(), Name = "Sticker privacy" }); var community = (await created.Content.ReadFromJsonAsync<CommunityDetails>())!;
        var channel = $"/api/v1/communities/{community.Id}/channels/{community.Channels[0].Id}"; var channelRequest = request with { ClientMessageId = Guid.NewGuid() };
        using var channelSent = await Command(owner, channel + "/stickers", channelRequest); Assert.Equal(HttpStatusCode.Created, channelSent.StatusCode); var channelMessage = (await channelSent.Content.ReadFromJsonAsync<MessageDto>())!;
        Assert.Equal(HttpStatusCode.NotFound, (await Command(outsider, channel + "/stickers", request)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(channel + $"/attachments/{channelMessage.Attachment!.Id}")).StatusCode);
        using var invitation = await Command(owner, $"/api/v1/communities/{community.Id}/invites", new CreateInviteRequest(Guid.NewGuid(), 24, 10));
        var invite = (await invitation.Content.ReadFromJsonAsync<CreatedInvite>())!;
        Assert.Equal(HttpStatusCode.OK, (await Command(peer, "/api/v1/communities/join", new AcceptInviteRequest(invite.Code))).StatusCode);
        var accessPath = $"/api/v1/communities/{community.Id}/access"; var policy = (await owner.GetFromJsonAsync<AccessPolicy>(accessPath))!;
        using var readOnly = await Command(owner, accessPath, new SaveAccessRequest(Guid.NewGuid(), policy with { Roles = policy.Roles.Select(r => r with { Grants = ChannelAccess.View }).ToArray() }), "PUT");
        Assert.Equal(HttpStatusCode.OK, readOnly.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(peer, channel + "/stickers", request with { ClientMessageId = Guid.NewGuid() })).StatusCode);
        policy = (await owner.GetFromJsonAsync<AccessPolicy>(accessPath))!;
        using var hidden = await Command(owner, accessPath, new SaveAccessRequest(Guid.NewGuid(), policy with { Roles = policy.Roles.Select(r => r with { Grants = 0 }).ToArray() }), "PUT");
        Assert.Equal(HttpStatusCode.OK, hidden.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(peer, channel + "/stickers", request with { ClientMessageId = Guid.NewGuid() })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await peer.GetAsync(channel + $"/attachments/{channelMessage.Attachment!.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(owner, Root + $"/{pack.Name}/retire")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(owner, Root + $"/{pack.Name}/retire")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await peer.GetAsync(Root + $"/{pack.Name}")).StatusCode);
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var store = scope.ServiceProvider.GetRequiredService<AttachmentStore>();
        await AttachmentCleanup.PurgeAsync(db, store, default); Assert.Throws<FileNotFoundException>(() => store.Open(Guid.Parse(asset.Id)));
        using var retry = await Command(owner, root + "/stickers", request); Assert.Equal(HttpStatusCode.Created, retry.StatusCode); Assert.Equal(message, await retry.Content.ReadFromJsonAsync<DirectMessageDto>());
        Assert.Equal(HttpStatusCode.Created, (await Command(owner, channel + "/stickers", channelRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner, root + "/stickers", request with { Content = "Changed" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(owner, root + "/stickers", request with { ClientMessageId = Guid.NewGuid() })).StatusCode);
        using var bytes = await peer.GetAsync(root + $"/attachments/{message.Attachment.Id}"); Assert.Equal(GifMediaTests.Animated(), await bytes.Content.ReadAsByteArrayAsync());
        using var channelBytes = await owner.GetAsync(channel + $"/attachments/{channelMessage.Attachment!.Id}"); Assert.Equal(GifMediaTests.Animated(), await channelBytes.Content.ReadAsByteArrayAsync());
        Assert.Single((await owner.GetFromJsonAsync<DirectSnapshot>(root + "/messages"))!.Messages);
        using var removed = await Command(owner, root + $"/messages/{message.Id}/delete", new DeleteDirectRequest(Guid.NewGuid(), "1")); Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await peer.GetAsync(root + $"/attachments/{message.Attachment.Id}")).StatusCode);
    }
}
