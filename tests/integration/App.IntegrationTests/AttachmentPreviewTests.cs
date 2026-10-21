using System.Net;
using System.Net.Http.Json;
using System.Buffers.Binary;
using System.Text.Json;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.DirectMessages;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace App.IntegrationTests;

[Trait("Category", "PostgreSQL")]
public sealed class AttachmentPreviewTests(AccountsDatabase storage) : IClassFixture<AccountsDatabase>
{
    private static readonly byte[] Small = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=");
    private static readonly byte[] Original = Small.Concat(new byte[4096]).ToArray();
    private static async Task<HttpResponseMessage> Command(HttpClient c, string path, object body, string method = "POST") {
        using var request = new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-CSRF-TOKEN", (await c.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!.RequestToken); return await c.SendAsync(request);
    }
    private static async Task<UserProfile> Register(HttpClient c) {
        using var r = await Command(c, "/api/v1/account/register", new { Email = $"preview-{Guid.NewGuid():N}@example.test", Password = "Synthetic preview passphrase 42", DisplayName = "Preview QA" }); Assert.Equal(HttpStatusCode.Created, r.StatusCode); return (await r.Content.ReadFromJsonAsync<UserProfile>())!;
    }
    private static async Task<HttpResponseMessage> Upload(HttpClient c, string path, Guid id, byte[]? preview, bool text = false) {
        using var request = new HttpRequestMessage(HttpMethod.Post, path + "/attachments"); request.Headers.Add("X-CSRF-TOKEN", (await c.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!.RequestToken);
        var form = new MultipartFormDataContent { { new StringContent(id.ToString()), "clientMessageId" }, { new ByteArrayContent(text ? "not an image"u8.ToArray() : Original), "file", text ? "notes.txt" : "original.png" } };
        if (preview is not null) form.Add(new ByteArrayContent(preview), "preview", "preview.png"); request.Content = form; return await c.SendAsync(request);
    }
    [Theory]
    [InlineData(false)] [InlineData(true)]
    public async Task DerivedBytesShareAuthorizationRetryQuotaAndDeletionWithTheirOriginal(bool direct)
    {
        await using var host = new FoundationFactory(connection: storage.Connection, permitLimit:120); using var owner = host.CreateClient(); using var peer = host.CreateClient(); using var outsider = host.CreateClient(); using var anonymous = host.CreateClient();
        await Register(owner); var member = await Register(peer); await Register(outsider);
        string path;
        if (direct) { using var r = await Command(owner, "/api/v1/direct-messages", new StartDirectRequest(Guid.NewGuid(), Guid.Parse(member.Id))); var conversation = (await r.Content.ReadFromJsonAsync<DirectConversationDto>())!; path = "/api/v1/direct-messages/" + conversation.Id; }
        else {
            using var created = await Command(owner, "/api/v1/communities", new { ClientRequestId = Guid.NewGuid(), Name = "Preview community" }); var c = (await created.Content.ReadFromJsonAsync<CommunityDetails>())!;
            using var invite = await Command(owner, $"/api/v1/communities/{c.Id}/invites", new { ClientRequestId = Guid.NewGuid(), LifetimeHours = 1, MaxUses = 2 }); var code = (await invite.Content.ReadFromJsonAsync<CreatedInvite>())!.Code;
            Assert.Equal(HttpStatusCode.OK, (await Command(peer, "/api/v1/communities/join", new { Code = code })).StatusCode); path = $"/api/v1/communities/{c.Id}/channels/{c.Channels[0].Id}";
        }
        var id = Guid.NewGuid(); using var uploaded = await Upload(owner, path, id, Small); Assert.Equal(HttpStatusCode.Created, uploaded.StatusCode);
        var raw = System.Text.Json.JsonDocument.Parse(await uploaded.Content.ReadAsStringAsync()); var messageId = raw.RootElement.GetProperty("id").GetString()!; var a = raw.RootElement.GetProperty("attachment").Deserialize<AttachmentDto>(new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.True(a.HasPreview); Assert.Equal(Small.Length, a.PreviewSize);
        using var again = await Upload(owner, path, id, Small); Assert.Equal(HttpStatusCode.Created, again.StatusCode); Assert.Equal(messageId, System.Text.Json.JsonDocument.Parse(await again.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetString());
        using var conflict = await Upload(owner, path, id, Small.Concat(new byte[] { 0 }).ToArray()); Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        var url = path + "/attachments/" + a.Id; using var original = await peer.GetAsync(url); using var preview = await peer.GetAsync(url + "?preview=true");
        Assert.Equal(Original, await original.Content.ReadAsByteArrayAsync()); Assert.Equal(Small, await preview.Content.ReadAsByteArrayAsync()); Assert.True(preview.Headers.CacheControl!.NoStore); Assert.Equal("application/octet-stream", preview.Content.Headers.ContentType!.MediaType);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(url + "?preview=true")).StatusCode); Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(url + "?preview=true")).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Upload(owner, path, Guid.NewGuid(), Small, true)).StatusCode);
        var huge = Small.ToArray(); BinaryPrimitives.WriteUInt32BigEndian(huge.AsSpan(16, 4), 321); Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Upload(owner, path, Guid.NewGuid(), huge)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(owner, path + $"/messages/{messageId}/delete", new DeleteMessageRequest(Guid.NewGuid(), "1"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await peer.GetAsync(url + "?preview=true")).StatusCode); Assert.Equal(HttpStatusCode.NotFound, (await peer.GetAsync(url)).StatusCode);
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var files = scope.ServiceProvider.GetRequiredService<AttachmentStore>();
        var previewId = direct ? (await db.DirectAttachments.SingleAsync(x => x.Id == Guid.Parse(a.Id))).PreviewId : (await db.MessageAttachments.SingleAsync(x => x.Id == Guid.Parse(a.Id))).PreviewId;
        Assert.NotNull(previewId); await AttachmentCleanup.PurgeAsync(db, files, CancellationToken.None); Assert.Throws<FileNotFoundException>(() => files.Open(previewId!.Value));
        if (direct) (await db.DirectAttachments.SingleAsync(x => x.Id == Guid.Parse(a.Id))).PreviewSize = null;
        else (await db.MessageAttachments.SingleAsync(x => x.Id == Guid.Parse(a.Id))).PreviewSize = null;
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
    [Fact]
    public async Task PreviewBytesCountAgainstTheSameQuota()
    {
        await using var host = new FoundationFactory(connection: storage.Connection, permitLimit:120, fileQuota:Original.Length, fileRoot:Path.Combine(Path.GetTempPath(), "dosvyazi-preview-" + Guid.NewGuid().ToString("N")));
        using var owner = host.CreateClient(); using var peer = host.CreateClient(); await Register(owner); var user = await Register(peer);
        using var started = await Command(owner, "/api/v1/direct-messages", new StartDirectRequest(Guid.NewGuid(), Guid.Parse(user.Id))); var c = (await started.Content.ReadFromJsonAsync<DirectConversationDto>())!; var path = "/api/v1/direct-messages/" + c.Id;
        Assert.Equal(HttpStatusCode.Conflict, (await Upload(owner, path, Guid.NewGuid(), Small)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Upload(owner, path, Guid.NewGuid(), null)).StatusCode);
    }
}
