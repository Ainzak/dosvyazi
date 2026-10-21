using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Communities;
using App.Api.Features.Forums;
using App.Api.Features.Messages;
using App.Api.Features.Navigation;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace App.IntegrationTests;
public sealed partial class AccessTests
{
    private static async Task<Guid> AddForum(Person owner, CommunityDetails c)
    {
        var id = Guid.NewGuid(); var p = await Policy(owner, c);
        Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, p with { Channels = [.. p.Channels, new(id, "planning-forum", null, "Forum")] })).StatusCode); return id;
    }
    private static string Topics(CommunityDetails c, Guid forum) => Root(c) + $"/forums/{forum}/topics";
    [Fact]
    public async Task ForumTopicCreationIsAtomicAndReplaySafeWithDistinctRoutesAndIsolatedConfiguration()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory); var c = await Create(owner); await Join(owner, member, c); var forum = await AddForum(owner, c);
        var request = new CreateForumTopicRequest(Guid.NewGuid(), "Weekend topic", "forumneedle first post");
        var replies = await Task.WhenAll(Command(member.Client, Topics(c, forum), request), Command(member.Client, Topics(c, forum), request)); Assert.All(replies, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));
        var topic = (await replies[0].Content.ReadFromJsonAsync<ForumTopicDto>())!; Assert.Equal(topic.Id, (await replies[1].Content.ReadFromJsonAsync<ForumTopicDto>())!.Id); Assert.Equal(1, topic.MessageCount);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member.Client, Topics(c, forum), request with { Content = "Changed" })).StatusCode);
        var path = Root(c) + $"/channels/{topic.Id}"; Assert.Single((await owner.Client.GetFromJsonAsync<MessageSnapshot>(path + "/messages"))!.Messages);
        Assert.Equal(1, (await owner.Client.GetFromJsonAsync<ReadStateDto>(path + "/read-state"))!.Unread); Assert.Single((await owner.Client.GetFromJsonAsync<SearchPage>(path + "/search?query=forumneedle"))!.Messages);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(Root(c) + $"/channels/{forum}/messages")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(owner.Client, Root(c) + $"/channels/{forum}/messages", new SendMessageRequest(Guid.NewGuid(), "Not a timeline"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(Root(c) + $"/channels/{forum}/threads")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(Topics(c, Guid.Parse(c.Channels[0].Id)))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(Topics(c, Guid.Parse(topic.Id)))).StatusCode);
        var message = Assert.Single((await owner.Client.GetFromJsonAsync<MessageSnapshot>(path + "/messages"))!.Messages);
        var source = (await owner.Client.GetFromJsonAsync<SourceDto>($"/api/v1/navigation/channel/{topic.Id}/messages/{message.Id}"))!; Assert.Equal($"/communities/{c.Id}/forums/{forum}/topics/{topic.Id}?message={message.Id}", source.Href);
        var details = (await owner.Client.GetFromJsonAsync<CommunityDetails>(Root(c)))!; Assert.Equal("Forum", Assert.Single(details.Channels, ch => ch.Id == forum.ToString()).Kind); Assert.Equal(2, details.Channels.Length);
        var policy = await Policy(owner, c); Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, policy)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save(owner, c, (await Policy(owner, c)) with { Channels = policy.Channels.Select(ch => ch.Id == forum ? ch with { Kind = "Text" } : ch).ToArray() })).StatusCode);
        var config = (await owner.Client.GetFromJsonAsync<CommunityConfiguration>(Root(c) + "/configuration"))!; Assert.Equal(2, config.Channels.Length); Assert.Contains(config.Channels, ch => ch.Kind == "Forum");
        Assert.DoesNotContain(config.Channels, ch => ch.Name == topic.Title);
        var restored = await Command(owner.Client, "/api/v1/communities/configuration/restore", new { ClientRequestId = Guid.NewGuid(), Name = "Forum template copy", Configuration = config }); Assert.Equal(HttpStatusCode.Created, restored.StatusCode);
        var copy = (await restored.Content.ReadFromJsonAsync<ConfigurationRestored>())!; var copyDetails = (await owner.Client.GetFromJsonAsync<CommunityDetails>("/api/v1/communities/" + copy.CommunityId))!;
        var copyForum = Assert.Single(copyDetails.Channels, ch => ch.Kind == "Forum"); Assert.Empty((await owner.Client.GetFromJsonAsync<ForumTopicPage>($"/api/v1/communities/{copy.CommunityId}/forums/{copyForum.Id}/topics"))!.Topics);
    }
    [Fact]
    public async Task ForumTopicArchiveVersionsAndInheritedPrivateAccessCoverRawPipelines()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory); using var other = await User(factory); var c = await Create(owner); await Join(owner, member, c); await Join(owner, other, c); var forum = await AddForum(owner, c);
        var topic = (await (await Command(member.Client, Topics(c, forum), new CreateForumTopicRequest(Guid.NewGuid(), "Protected topic", "Original post"))).Content.ReadFromJsonAsync<ForumTopicDto>())!;
        var detail = Topics(c, forum) + "/" + topic.Id; var path = Root(c) + $"/channels/{topic.Id}"; var archive = new ChangeForumTopicRequest(Guid.NewGuid(), topic.Version, topic.Title, true);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(other.Client, detail, archive, "PUT")).StatusCode);
        var closed = (await (await Command(member.Client, detail, archive, "PUT")).Content.ReadFromJsonAsync<ForumTopicDto>())!; Assert.True(closed.Archived); Assert.False(closed.CanSend); Assert.True(closed.CanManage);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(owner.Client, path + "/messages", new SendMessageRequest(Guid.NewGuid(), "Closed"))).StatusCode);
        var message = Assert.Single((await owner.Client.GetFromJsonAsync<MessageSnapshot>(path + "/messages"))!.Messages);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(member.Client, path + $"/messages/{message.Id}", new EditMessageRequest(Guid.NewGuid(), message.Version, "Closed edit"), "PUT")).StatusCode);
        var reopened = (await (await Command(member.Client, detail, archive with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = closed.Version, Archived = false }, "PUT")).Content.ReadFromJsonAsync<ForumTopicDto>())!;
        Assert.False((await (await Command(member.Client, detail, archive, "PUT")).Content.ReadFromJsonAsync<ForumTopicDto>())!.Archived);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member.Client, detail, archive with { ClientRequestId = Guid.NewGuid() }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(other.Client, "/api/v1/navigation/bookmarks", new BookmarkRequest(Guid.NewGuid(), "channel", Guid.Parse(topic.Id), Guid.Parse(message.Id), "retained private note", []), "PUT")).StatusCode);
        using var file = new MultipartFormDataContent(); file.Add(new StringContent(Guid.NewGuid().ToString()), "clientMessageId"); file.Add(new ByteArrayContent("private topic file"u8.ToArray()), "file", "topic.txt");
        using var upload = new HttpRequestMessage(HttpMethod.Post, path + "/attachments") { Content = file }; upload.Headers.Add("X-CSRF-TOKEN", (await owner.Client.GetFromJsonAsync<App.Api.Features.Accounts.CsrfResponse>("/api/v1/account/csrf"))!.RequestToken);
        var attached = (await (await owner.Client.SendAsync(upload)).Content.ReadFromJsonAsync<MessageDto>())!;
        var p = await Policy(owner, c); Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, p with { ChannelRules = [new(forum, Guid.Parse(c.Id), 0, ChannelAccess.View)] })).StatusCode);
        foreach (var suffix in new[] { "/messages", "/events?after=0", "/search?query=Original", "/read-state", "/attachments/" + attached.Attachment!.Id }) Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(path + suffix)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(detail)).StatusCode); Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(Topics(c, forum))).StatusCode);
        Assert.All((await other.Client.GetFromJsonAsync<BookmarkPage>("/api/v1/navigation/bookmarks"))!.Items, b => Assert.Null(b.Source));
        Assert.DoesNotContain((await member.Client.GetFromJsonAsync<CommunityDetails>(Root(c)))!.Channels, ch => ch.Id == forum.ToString());
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.GetAsync(detail)).StatusCode); Assert.False(reopened.Archived);
    }
    [Fact]
    public async Task ForumTopicsRejectInvalidMetadataAndSendingWithoutAuthority()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory); var c = await Create(owner); await Join(owner, member, c); var forum = await AddForum(owner, c);
        Assert.Equal(HttpStatusCode.BadRequest, (await Command(owner.Client, Topics(c, forum), new CreateForumTopicRequest(Guid.NewGuid(), "Valid title", "   "))).StatusCode);
        var p = await Policy(owner, c); Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, p with { ChannelRules = [new(forum, Guid.Parse(c.Id), 0, ChannelAccess.Send)] })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(member.Client, Topics(c, forum), new CreateForumTopicRequest(Guid.NewGuid(), "No permission", "Post"))).StatusCode);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var root = await RootMessage(owner, c); var thread = await Thread(owner, c, root);
        var id = Guid.Parse(thread.Id); var failure = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"TextChannels\" SET \"Kind\" = 'ForumTopic' WHERE \"Id\" = {id}")); Assert.Equal("23514", failure.SqlState);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await owner.Client.GetAsync(Topics(c, forum) + "?before=-1")).StatusCode);
    }
}
