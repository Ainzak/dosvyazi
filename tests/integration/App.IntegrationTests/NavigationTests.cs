using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.DirectMessages;
using App.Api.Features.Messages;
using App.Api.Features.Navigation;

namespace App.IntegrationTests;

[Trait("Category", "PostgreSQL")]
public sealed class NavigationTests(AccountsDatabase storage) : IClassFixture<AccountsDatabase>
{
    private FoundationFactory Factory() => new(connection: storage.Connection, permitLimit: 120);
    private static async Task<HttpResponseMessage> Command(HttpClient client, string path, object body, string method = "POST")
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-CSRF-TOKEN", (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!.RequestToken); return await client.SendAsync(request);
    }
    private static async Task<UserProfile> Register(HttpClient client, string name)
    {
        using var response = await Command(client, "/api/v1/account/register", new { Email = $"navigation-{Guid.NewGuid():N}@example.test", Password = "Synthetic navigation passphrase 42", DisplayName = name });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode); return (await response.Content.ReadFromJsonAsync<UserProfile>())!;
    }
    private static async Task<CommunityDetails> Create(HttpClient owner)
    {
        using var response = await Command(owner, "/api/v1/communities", new CreateCommunityRequest(Guid.NewGuid(), "Navigation tests")); return (await response.Content.ReadFromJsonAsync<CommunityDetails>())!;
    }
    private static async Task Join(HttpClient owner, HttpClient member, CommunityDetails c)
    {
        using var response = await Command(owner, $"/api/v1/communities/{c.Id}/invites", new CreateInviteRequest(Guid.NewGuid(), 24, 10)); var invite = (await response.Content.ReadFromJsonAsync<CreatedInvite>())!;
        Assert.Equal(HttpStatusCode.OK, (await Command(member, "/api/v1/communities/join", new AcceptInviteRequest(invite.Code))).StatusCode);
    }
    private static string Messages(CommunityDetails c) => $"/api/v1/communities/{c.Id}/channels/{c.Channels[0].Id}/messages";
    private static string Scope(CommunityDetails c) => $"/api/v1/navigation/channel/{c.Channels[0].Id}";
    private static async Task<MessageDto> Send(HttpClient client, CommunityDetails c, SendMessageRequest request)
    {
        using var response = await Command(client, Messages(c), request); Assert.Equal(HttpStatusCode.Created, response.StatusCode); return (await response.Content.ReadFromJsonAsync<MessageDto>())!;
    }
    private static Task<HttpResponseMessage> Bookmark(HttpClient client, BookmarkRequest request) => Command(client, "/api/v1/navigation/bookmarks", request, "PUT");
    private static Task<NoticePage?> Notices(HttpClient client) => client.GetFromJsonAsync<NoticePage>("/api/v1/navigation/notices");

    [Fact]
    public async Task RepliesAndMentionsAreScopedDuplicateSafeAndNeverCopyDeletedOrRevokedContent()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var member = host.CreateClient(); using var outsider = host.CreateClient();
        var author = await Register(owner, "Author"); await Register(member, "Member"); var stranger = await Register(outsider, "Stranger"); var c = await Create(owner); await Join(owner, member, c);
        var original = await Send(owner, c, new(Guid.NewGuid(), "Private original"));
        var request = new SendMessageRequest(Guid.NewGuid(), "Reply text", Guid.Parse(original.Id), [Guid.Parse(author.Id)]);
        var replies = await Task.WhenAll(Command(member, Messages(c), request), Command(member, Messages(c), request));
        Assert.All(replies, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode)); var reply = (await replies[0].Content.ReadFromJsonAsync<MessageDto>())!; foreach (var r in replies) r.Dispose();
        Assert.Equal(original.Id, reply.ReplyToId); Assert.Equal([author.Id], reply.MentionUserIds!); Assert.Single((await Notices(owner))!.Items);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member, Messages(c), request with { ReplyToId = null })).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(member, Messages(c), request with { ClientMessageId = Guid.NewGuid(), MentionUserIds = [Guid.Parse(stranger.Id)] })).StatusCode);
        var other = await Create(owner); var cross = await Send(owner, other, new(Guid.NewGuid(), "Different source"));
        Assert.Equal(HttpStatusCode.NotFound, (await Command(member, Messages(c), request with { ClientMessageId = Guid.NewGuid(), ReplyToId = Guid.Parse(cross.Id) })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(Scope(c) + $"/messages/{original.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(Scope(c) + "/members")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(Scope(c) + "/preference")).StatusCode);
        using var edited = await Command(owner, Messages(c) + "/" + original.Id, new EditMessageRequest(Guid.NewGuid(), original.Version, "Edited original"), "PUT");
        var version = (await edited.Content.ReadFromJsonAsync<MessageCommandResult>())!.AppliedVersion;
        Assert.Equal("Edited original", (await member.GetFromJsonAsync<SourceDto>(Scope(c) + $"/messages/{original.Id}"))!.Content);
        using var deleted = await Command(owner, Messages(c) + $"/{original.Id}/delete", new DeleteMessageRequest(Guid.NewGuid(), version)); Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.GetAsync(Scope(c) + $"/messages/{original.Id}")).StatusCode);
        var bookmark = new BookmarkRequest(Guid.NewGuid(), "channel", Guid.Parse(c.Channels[0].Id), Guid.Parse(reply.Id), "My private agreement", ["Work"]);
        Assert.Equal(HttpStatusCode.OK, (await Bookmark(member, bookmark)).StatusCode); Assert.Empty((await owner.GetFromJsonAsync<BookmarkPage>("/api/v1/navigation/bookmarks"))!.Items);
        var policy = (await owner.GetFromJsonAsync<AccessPolicy>($"/api/v1/communities/{c.Id}/access"))!;
        Assert.Equal(HttpStatusCode.OK, (await Command(owner, $"/api/v1/communities/{c.Id}/access", new SaveAccessRequest(Guid.NewGuid(), policy with { Roles = policy.Roles.Select(r => r with { Grants = 0 }).ToArray() }), "PUT")).StatusCode);
        var saved = (await member.GetFromJsonAsync<BookmarkPage>("/api/v1/navigation/bookmarks?tag=work"))!.Items.Single(); Assert.Null(saved.Source); Assert.Equal(bookmark.Note, saved.Note);
        Assert.Equal(HttpStatusCode.NotFound, (await member.GetAsync(Scope(c) + $"/messages/{reply.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Bookmark(member, bookmark with { ClientRequestId = Guid.NewGuid(), Removed = true })).StatusCode);
        Assert.Empty((await member.GetFromJsonAsync<BookmarkPage>("/api/v1/navigation/bookmarks"))!.Items);
    }

    [Fact]
    public async Task PreferencesFilterDeliveryAndReadingWhileEditsAndRetriesDoNotDuplicateNotices()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner, "Owner"); var recipient = await Register(member, "Recipient"); var c = await Create(owner); await Join(owner, member, c);
        await Send(owner, c, new(Guid.NewGuid(), "Default ordinary message")); Assert.Empty((await Notices(member))!.Items);
        var all = new PreferenceRequest(Guid.NewGuid(), "all"); Assert.Equal(HttpStatusCode.OK, (await Command(member, Scope(c) + "/preference", all, "PUT")).StatusCode);
        var ordinary = await Send(owner, c, new(Guid.NewGuid(), "All notifications")); Assert.Single((await Notices(member))!.Items);
        await Command(member, Scope(c) + "/preference", new PreferenceRequest(Guid.NewGuid(), "quiet"), "PUT");
        await Send(owner, c, new(Guid.NewGuid(), "Quiet mention", MentionUserIds: [Guid.Parse(recipient.Id)])); Assert.Empty((await Notices(member))!.Items);
        await Command(member, Scope(c) + "/preference", all, "PUT"); Assert.Equal("quiet", (await member.GetFromJsonAsync<PreferenceDto>(Scope(c) + "/preference"))!.Mode);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member, Scope(c) + "/preference", all with { Mode = "mentions" }, "PUT")).StatusCode);
        await Command(member, Scope(c) + "/preference", new PreferenceRequest(Guid.NewGuid(), "mentions"), "PUT");
        var mentioned = await Send(owner, c, new(Guid.NewGuid(), "Explicit mention", MentionUserIds: [Guid.Parse(recipient.Id)]));
        var notice = (await Notices(member))!.Items.Single(); Assert.Equal(mentioned.Id, notice.Source.MessageId);
        await Command(owner, Messages(c) + "/" + mentioned.Id, new EditMessageRequest(Guid.NewGuid(), mentioned.Version, "Updated mention"), "PUT");
        Assert.Equal("Updated mention", (await Notices(member))!.Items.Single().Source.Content);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(owner, $"/api/v1/navigation/notices/{notice.Id}", new NoticeReadRequest(Guid.NewGuid(), true), "PUT")).StatusCode);
        var read = new NoticeReadRequest(Guid.NewGuid(), true); Assert.Equal(HttpStatusCode.OK, (await Command(member, $"/api/v1/navigation/notices/{notice.Id}", read, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(member, $"/api/v1/navigation/notices/{notice.Id}", read, "PUT")).StatusCode); Assert.Empty((await Notices(member))!.Items);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member, $"/api/v1/navigation/notices/{notice.Id}", read with { Read = false }, "PUT")).StatusCode);
        Assert.NotEqual(ordinary.Id, mentioned.Id);
    }

    [Fact]
    public async Task DirectSourcesRespectParticipantsBlocksDeletionAndPrivateBookmarkReceipts()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var peer = host.CreateClient(); using var outsider = host.CreateClient();
        await Register(owner, "Direct owner"); var recipient = await Register(peer, "Direct peer"); var stranger = await Register(outsider, "Outsider");
        using var started = await Command(owner, "/api/v1/direct-messages", new StartDirectRequest(Guid.NewGuid(), Guid.Parse(recipient.Id))); var c = (await started.Content.ReadFromJsonAsync<DirectConversationDto>())!;
        var root = $"/api/v1/direct-messages/{c.Id}"; var tools = $"/api/v1/navigation/direct/{c.Id}";
        using var sent = await Command(owner, root + "/messages", new SendMessageRequest(Guid.NewGuid(), "Direct original")); var message = (await sent.Content.ReadFromJsonAsync<DirectMessageDto>())!;
        var request = new SendMessageRequest(Guid.NewGuid(), "Direct reply", Guid.Parse(message.Id));
        using var replied = await Command(peer, root + "/messages", request); Assert.Equal(HttpStatusCode.Created, replied.StatusCode);
        Assert.Equal(message.Id, (await replied.Content.ReadFromJsonAsync<DirectMessageDto>())!.ReplyToId); Assert.Single((await Notices(owner))!.Items);
        var privateCursor = (await Notices(owner))!.Items.Single().Id;
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync("/api/v1/navigation/notices?before=" + privateCursor)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(tools + $"/messages/{message.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(peer, root + "/messages", request with { ClientMessageId = Guid.NewGuid(), MentionUserIds = [Guid.Parse(stranger.Id)] })).StatusCode);
        var save = new BookmarkRequest(Guid.NewGuid(), "direct", Guid.Parse(c.Id), Guid.Parse(message.Id), "", []);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Bookmark(peer, save with { Note = "Invalid\0note" })).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await peer.GetAsync("/api/v1/navigation/bookmarks?query=%00")).StatusCode);
        var race = await Task.WhenAll(Bookmark(peer, save), Bookmark(peer, save)); foreach (var r in race) { Assert.Equal(HttpStatusCode.OK, r.StatusCode); r.Dispose(); }
        Assert.Single((await peer.GetFromJsonAsync<BookmarkPage>("/api/v1/navigation/bookmarks"))!.Items);
        await Bookmark(peer, save with { ClientRequestId = Guid.NewGuid(), Removed = true }); await Bookmark(peer, save); Assert.Empty((await peer.GetFromJsonAsync<BookmarkPage>("/api/v1/navigation/bookmarks"))!.Items);
        Assert.Equal(HttpStatusCode.Conflict, (await Bookmark(peer, save with { Note = "Reused ID" })).StatusCode);
        await Command(peer, root + "/block", new BlockDirectRequest(Guid.NewGuid(), true), "PUT"); Assert.Empty((await Notices(peer))!.Items);
        Assert.Equal(HttpStatusCode.OK, (await peer.GetAsync(tools + $"/messages/{message.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(owner, root + "/messages", new SendMessageRequest(Guid.NewGuid(), "Blocked", Guid.Parse(message.Id)))).StatusCode);
        await Command(owner, root + $"/messages/{message.Id}/delete", new DeleteDirectRequest(Guid.NewGuid(), message.Version));
        Assert.Equal(HttpStatusCode.NotFound, (await peer.GetAsync(tools + $"/messages/{message.Id}")).StatusCode);
    }

    [Fact]
    public async Task PrivateBookmarksPaginateAndFilterWithoutAcceptingAnotherActorsCursor()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var other = host.CreateClient();
        await Register(owner, "Bookmarks owner"); await Register(other, "Other account"); var c = await Create(owner);
        for (var i = 0; i < 26; i++)
        {
            var message = await Send(owner, c, new(Guid.NewGuid(), "Bookmark source " + i));
            Assert.Equal(HttpStatusCode.OK, (await Bookmark(owner, new(Guid.NewGuid(), "channel", Guid.Parse(c.Channels[0].Id), Guid.Parse(message.Id), "Note " + i.ToString("D2"), ["Project"])) ).StatusCode);
        }
        var page = (await owner.GetFromJsonAsync<BookmarkPage>("/api/v1/navigation/bookmarks?tag=project"))!; Assert.Equal(25, page.Items.Length); Assert.True(page.HasMore);
        var older = (await owner.GetFromJsonAsync<BookmarkPage>("/api/v1/navigation/bookmarks?before=" + page.Before))!; Assert.Single(older.Items); Assert.False(older.HasMore); Assert.DoesNotContain(older.Items[0].Id, page.Items.Select(x => x.Id));
        Assert.Single((await owner.GetFromJsonAsync<BookmarkPage>("/api/v1/navigation/bookmarks?query=Note%2000"))!.Items);
        Assert.Empty((await other.GetFromJsonAsync<BookmarkPage>("/api/v1/navigation/bookmarks"))!.Items);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync("/api/v1/navigation/bookmarks?before=" + page.Before)).StatusCode);
    }
}
