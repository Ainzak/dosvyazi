using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Features.Threads;
using App.Api.Features.Navigation;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace App.IntegrationTests;

public sealed partial class AccessTests
{
    [Fact]
    public async Task ParentRevocationCoversRawThreadFilesSourcesNotificationsAndLiveAuthorization()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory); using var outsider = await User(factory);
        var c = await Create(owner); await Join(owner, member, c); var root = await RootMessage(owner, c); var thread = await Thread(owner, c, root); var path = ChildMessages(c, thread);
        var small = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=");
        using var form = new MultipartFormDataContent(); form.Add(new StringContent(Guid.NewGuid().ToString()), "clientMessageId"); form.Add(new ByteArrayContent(small.Concat(new byte[4096]).ToArray()), "file", "thread.png"); form.Add(new ByteArrayContent(small), "preview", "preview.png");
        using var upload = new HttpRequestMessage(HttpMethod.Post, path + "/attachments") { Content = form }; upload.Headers.Add("X-CSRF-TOKEN", (await owner.Client.GetFromJsonAsync<App.Api.Features.Accounts.CsrfResponse>("/api/v1/account/csrf"))!.RequestToken);
        using var result = await owner.Client.SendAsync(upload); Assert.Equal(HttpStatusCode.Created, result.StatusCode); var attachment = (await result.Content.ReadFromJsonAsync<MessageDto>())!;
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync(path + "/attachments/" + attachment.Attachment!.Id + "?preview=true")).StatusCode);
        var mention = (await (await Command(owner.Client, path + "/messages", new SendMessageRequest(Guid.NewGuid(), "Thread mention", MentionUserIds: [Guid.Parse(member.Profile.Id)]))).Content.ReadFromJsonAsync<MessageDto>())!;
        var bookmark = new BookmarkRequest(Guid.NewGuid(), "channel", Guid.Parse(thread.Id), Guid.Parse(mention.Id), "private note", ["thread"]);
        Assert.Equal(HttpStatusCode.OK, (await Command(member.Client, "/api/v1/navigation/bookmarks", bookmark, "PUT")).StatusCode);
        Assert.Contains((await member.Client.GetFromJsonAsync<NoticePage>("/api/v1/navigation/notices"))!.Items, n => n.Source?.ContainerId == thread.Id);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var memberId = Guid.Parse(member.Profile.Id);
        var session = await db.Sessions.Include(s => s.User).SingleAsync(s => s.UserId == memberId);
        var connection = new MessageConnection("thread-authorization", memberId, session.Id, session.User.SecurityStamp!, Guid.Parse(c.Id), Guid.Parse(thread.Id), () => { });
        Assert.True(await MessageConnections.AuthorizedAsync(db, connection, CancellationToken.None));
        var p = await Policy(owner, c); p = p with { ChannelRules = [new(Guid.Parse(c.Channels[0].Id), Guid.Parse(c.Id), 0, ChannelAccess.View)] }; Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, p)).StatusCode);
        foreach (var suffix in new[] { "/messages", "/events?after=0", "/search?query=Thread", "/read-state", "/attachments/" + attachment.Attachment.Id, "/attachments/" + attachment.Attachment.Id + "?preview=true" })
            Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(path + suffix)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(Threads(c))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(Threads(c) + "/" + thread.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync(Threads(c) + "/" + thread.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync($"/api/v1/navigation/channel/{thread.Id}/messages/{mention.Id}")).StatusCode);
        Assert.False(await MessageConnections.AuthorizedAsync(db, connection, CancellationToken.None));
        var bookmarks = (await member.Client.GetFromJsonAsync<BookmarkPage>("/api/v1/navigation/bookmarks"))!; Assert.All(bookmarks.Items, item => Assert.Null(item.Source));
        var notices = (await member.Client.GetFromJsonAsync<NoticePage>("/api/v1/navigation/notices"))!; Assert.All(notices.Items, item => Assert.Null(item.Source));
        Assert.Equal(HttpStatusCode.OK, (await Command(owner.Client, Root(c) + $"/members/{member.Profile.Id}/ban", new BanMemberRequest(true), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(path + "/messages")).StatusCode);
    }

    private static string Threads(CommunityDetails c) => Channel(c) + "/threads";
    private static string ChildMessages(CommunityDetails c, ThreadDto thread) => Root(c) + $"/channels/{thread.Id}";
    private static async Task<MessageDto> RootMessage(Person person, CommunityDetails c, string text = "Original thread message")
    {
        using var response = await Command(person.Client, Channel(c) + "/messages", new SendMessageRequest(Guid.NewGuid(), text));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode); return (await response.Content.ReadFromJsonAsync<MessageDto>())!;
    }
    private static async Task<ThreadDto> Thread(Person person, CommunityDetails c, MessageDto root, string title = "Separate topic")
    {
        using var response = await Command(person.Client, Threads(c), new CreateThreadRequest(Guid.NewGuid(), Guid.Parse(root.Id), title));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode); return (await response.Content.ReadFromJsonAsync<ThreadDto>())!;
    }

    [Fact]
    public async Task ThreadCreationIsConcurrentPayloadBoundAndSeparateFromParentHistoryAndConfiguration()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory); var c = await Create(owner); await Join(owner, member, c);
        var root = await RootMessage(owner, c); var request = new CreateThreadRequest(Guid.NewGuid(), Guid.Parse(root.Id), "general");
        var responses = await Task.WhenAll(Command(owner.Client, Threads(c), request), Command(owner.Client, Threads(c), request));
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode)); var thread = (await responses[0].Content.ReadFromJsonAsync<ThreadDto>())!; Assert.Equal(thread.Id, (await responses[1].Content.ReadFromJsonAsync<ThreadDto>())!.Id);
        foreach (var r in responses) r.Dispose();
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner.Client, Threads(c), request with { Title = "Different" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member.Client, Threads(c), request with { ClientRequestId = Guid.NewGuid() })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(member.Client, Channel(c) + "/read-state", new ReadStateRequest(root.Sequence), "PUT")).StatusCode);
        var body = new SendMessageRequest(Guid.NewGuid(), "threadneedle", MentionUserIds: [Guid.Parse(member.Profile.Id)]);
        var posted = await Command(owner.Client, ChildMessages(c, thread) + "/messages", body); Assert.Equal(HttpStatusCode.Created, posted.StatusCode); var message = (await posted.Content.ReadFromJsonAsync<MessageDto>())!;
        Assert.Equal(message.Id, (await (await Command(owner.Client, ChildMessages(c, thread) + "/messages", body)).Content.ReadFromJsonAsync<MessageDto>())!.Id);
        Assert.Equal(0, (await member.Client.GetFromJsonAsync<ReadStateDto>(Channel(c) + "/read-state"))!.Unread);
        Assert.Equal(1, (await member.Client.GetFromJsonAsync<ReadStateDto>(ChildMessages(c, thread) + "/read-state"))!.Unread);
        Assert.Equal(root.Id, Assert.Single((await owner.Client.GetFromJsonAsync<MessageSnapshot>(Channel(c) + "/messages"))!.Messages).Id);
        Assert.Empty((await owner.Client.GetFromJsonAsync<SearchPage>(Channel(c) + "/search?query=threadneedle"))!.Messages);
        Assert.Single((await member.Client.GetFromJsonAsync<SearchPage>(ChildMessages(c, thread) + "/search?query=threadneedle"))!.Messages);
        var list = (await member.Client.GetFromJsonAsync<ThreadPage>(Threads(c)))!; Assert.Equal(1, Assert.Single(list.Threads).Unread); Assert.Equal(thread.Id, Assert.Single((await member.Client.GetFromJsonAsync<ThreadPage>(Threads(c) + "?roots=" + root.Id))!.Threads).Id);
        Assert.Empty((await member.Client.GetFromJsonAsync<ThreadPage>(Threads(c) + "?before=1"))!.Threads);
        Assert.Single((await owner.Client.GetFromJsonAsync<CommunityDetails>(Root(c)))!.Channels);
        var policy = await Policy(owner, c); Assert.Single(policy.Channels); var saved = await Save(owner, c, policy); Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var export = (await owner.Client.GetFromJsonAsync<CommunityConfiguration>(Root(c) + "/configuration"))!; Assert.Single(export.Channels); Assert.DoesNotContain(export.Channels, ch => ch.Id == Guid.Parse(thread.Id));
        policy = await Policy(owner, c); Assert.Equal(HttpStatusCode.BadRequest, (await Save(owner, c, policy with { Channels = [.. policy.Channels, new(Guid.Parse(thread.Id), thread.Title, null)] })).StatusCode);
        var source = (await member.Client.GetFromJsonAsync<SourceDto>($"/api/v1/navigation/channel/{thread.Id}/messages/{message.Id}"))!; Assert.Equal($"/communities/{c.Id}/channels/{c.Channels[0].Id}/threads/{thread.Id}?message={message.Id}", source.Href);
        Assert.Equal(HttpStatusCode.OK, (await Command(owner.Client, Channel(c) + $"/messages/{root.Id}/delete", new DeleteMessageRequest(Guid.NewGuid(), root.Version))).StatusCode);
        Assert.True((await member.Client.GetFromJsonAsync<ThreadDto>(Threads(c) + "/" + thread.Id))!.RootDeleted);
        Assert.Single((await member.Client.GetFromJsonAsync<MessageSnapshot>(ChildMessages(c, thread) + "/messages"))!.Messages);
    }

    [Fact]
    public async Task ThreadArchiveUsesCurrentAuthorityVersionsAndNeverReplaysOverANewerState()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory); using var peer = await User(factory);
        var c = await Create(owner); await Join(owner, member, c); await Join(owner, peer, c); var root = await RootMessage(owner, c); var thread = await Thread(member, c, root);
        var replyResponse = await Command(member.Client, ChildMessages(c, thread) + "/messages", new SendMessageRequest(Guid.NewGuid(), "Saved reply")); var reply = (await replyResponse.Content.ReadFromJsonAsync<MessageDto>())!;
        var archive = new ChangeThreadRequest(Guid.NewGuid(), thread.Version, thread.Title, true);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(peer.Client, Threads(c) + "/" + thread.Id, archive, "PUT")).StatusCode);
        var response = await Command(member.Client, Threads(c) + "/" + thread.Id, archive, "PUT"); Assert.Equal(HttpStatusCode.OK, response.StatusCode); var closed = (await response.Content.ReadFromJsonAsync<ThreadDto>())!;
        Assert.True(closed.Archived); Assert.False(closed.CanSend); Assert.True(closed.CanManage);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(owner.Client, ChildMessages(c, thread) + "/messages", new SendMessageRequest(Guid.NewGuid(), "Blocked"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(member.Client, ChildMessages(c, thread) + $"/messages/{reply.Id}", new EditMessageRequest(Guid.NewGuid(), reply.Version, "Blocked edit"), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(member.Client, ChildMessages(c, thread) + $"/messages/{reply.Id}/reaction", new ReactionRequest(Guid.NewGuid(), "👍", true), "PUT")).StatusCode);
        Assert.Single((await owner.Client.GetFromJsonAsync<ThreadPage>(Threads(c) + "?archived=true"))!.Threads); Assert.Empty((await owner.Client.GetFromJsonAsync<ThreadPage>(Threads(c)))!.Threads);
        var reopen = await Command(member.Client, Threads(c) + "/" + thread.Id, new ChangeThreadRequest(Guid.NewGuid(), closed.Version, "Renamed", false), "PUT"); Assert.Equal(HttpStatusCode.OK, reopen.StatusCode);
        var current = (await reopen.Content.ReadFromJsonAsync<ThreadDto>())!; Assert.False(current.Archived);
        var retried = (await (await Command(member.Client, Threads(c) + "/" + thread.Id, archive, "PUT")).Content.ReadFromJsonAsync<ThreadDto>())!; Assert.False(retried.Archived); Assert.Equal(current.Version, retried.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member.Client, Threads(c) + "/" + thread.Id, archive with { ClientRequestId = Guid.NewGuid() }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member.Client, Threads(c) + "/" + thread.Id, archive with { Archived = false }, "PUT")).StatusCode);
        var p = await Policy(owner, c); Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, p with { Roles = p.Roles.Select(r => r with { Grants = ChannelAccess.View }).ToArray() })).StatusCode);
        Assert.False((await member.Client.GetFromJsonAsync<ThreadDto>(Threads(c) + "/" + thread.Id))!.CanManage);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(member.Client, Threads(c) + "/" + thread.Id, new ChangeThreadRequest(Guid.NewGuid(), current.Version, current.Title, true), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(owner.Client, Threads(c) + "/" + thread.Id, new ChangeThreadRequest(Guid.NewGuid(), current.Version, current.Title, true), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(owner.Client, ChildMessages(c, thread) + $"/messages/{reply.Id}/delete", new DeleteMessageRequest(Guid.NewGuid(), reply.Version))).StatusCode);
    }

    [Fact]
    public async Task ThreadsRejectNestedCrossParentRootsMalformedMetadataAndLifetimeOverflow()
    {
        await using var factory = Factory(); using var owner = await User(factory); var c = await Create(owner); var other = await Create(owner); var root = await RootMessage(owner, c); var foreign = await RootMessage(owner, other); var thread = await Thread(owner, c, root);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(owner.Client, Threads(c), new CreateThreadRequest(Guid.NewGuid(), Guid.Parse(foreign.Id), "Foreign"))).StatusCode);
        var child = (await (await Command(owner.Client, ChildMessages(c, thread) + "/messages", new SendMessageRequest(Guid.NewGuid(), "Nested source"))).Content.ReadFromJsonAsync<MessageDto>())!;
        Assert.Equal(HttpStatusCode.NotFound, (await Command(owner.Client, ChildMessages(c, thread) + "/threads", new CreateThreadRequest(Guid.NewGuid(), Guid.Parse(child.Id), "Nested"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(Threads(other) + "/" + thread.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await owner.Client.GetAsync(Threads(c) + "?before=-1")).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await owner.Client.GetAsync(Threads(c) + "?roots=" + string.Join(',', Enumerable.Repeat(root.Id, 101)))).StatusCode);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var threadId = Guid.Parse(thread.Id);
        var failure = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"TextChannels\" SET \"ThreadCreatorId\" = NULL WHERE \"Id\" = {threadId}")); Assert.Equal("23514", failure.SqlState);
        var foreignRoot = Guid.Parse(foreign.Id); var fk = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"TextChannels\" SET \"RootMessageId\" = {foreignRoot} WHERE \"Id\" = {threadId}")); Assert.Equal("23503", fk.SqlState);
        var id = Guid.Parse(c.Channels[0].Id); await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"TextChannels\" SET \"LastThreadNumber\" = 1000 WHERE \"Id\" = {id}");
        var another = await RootMessage(owner, c); Assert.Equal(HttpStatusCode.Conflict, (await Command(owner.Client, Threads(c), new CreateThreadRequest(Guid.NewGuid(), Guid.Parse(another.Id), "Over limit"))).StatusCode);
    }
}
