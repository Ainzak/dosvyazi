using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace App.IntegrationTests;

[Trait("Category", "PostgreSQL")]
public sealed class MessageTests(AccountsDatabase database) : IClassFixture<AccountsDatabase>
{
    private FoundationFactory Factory() => new(connection: database.Connection, permitLimit: 120);
    private sealed record Person(HttpClient Client, UserProfile Profile, string Cookie) : IDisposable { public void Dispose() => Client.Dispose(); }
    private static async Task<HttpResponseMessage> Command(HttpClient client, string path, object? body = null, string method = "POST")
    {
        var csrf = (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!;
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        request.Headers.Add("X-CSRF-TOKEN", csrf.RequestToken);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await client.SendAsync(request);
    }
    private static async Task<Person> User(FoundationFactory factory)
    {
        var client = factory.CreateClient();
        using var response = await Command(client, "/api/v1/account/register", new { Email = $"messages-{Guid.NewGuid():N}@example.test", Password = "Synthetic message passphrase 42", DisplayName = "Message tester" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return new(client, (await response.Content.ReadFromJsonAsync<UserProfile>())!, response.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith("dosvyazi.session=", StringComparison.Ordinal)).Split(';')[0]);
    }
    private static async Task<CommunityDetails> Create(Person owner)
    {
        using var response = await Command(owner.Client, "/api/v1/communities", new { ClientRequestId = Guid.NewGuid(), Name = "Message test community" });
        return (await response.Content.ReadFromJsonAsync<CommunityDetails>())!;
    }
    private static string PathFor(CommunityDetails community) => $"/api/v1/communities/{community.Id}/channels/{community.Channels[0].Id}";
    private static async Task Join(Person owner, Person member, CommunityDetails community)
    {
        using var response = await Command(owner.Client, $"/api/v1/communities/{community.Id}/invites", new { ClientRequestId = Guid.NewGuid(), LifetimeHours = 24, MaxUses = 10 });
        var invite = (await response.Content.ReadFromJsonAsync<CreatedInvite>())!;
        using var join = await Command(member.Client, "/api/v1/communities/join", new { invite.Code });
        Assert.Equal(HttpStatusCode.OK, join.StatusCode);
    }
    private static async Task<MessageDto> Send(Person user, CommunityDetails community, string text, Guid? clientId = null)
    {
        using var response = await Command(user.Client, PathFor(community) + "/messages", new { ClientMessageId = clientId ?? Guid.NewGuid(), Content = text });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<MessageDto>())!;
    }
    private async Task Publish(FoundationFactory factory, CommunityDetails community)
    {
        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var ids = await context.OutboxEntries.Where(item => item.Event.ChannelId == Guid.Parse(community.Channels[0].Id)).Select(item => item.Id).ToArrayAsync();
        var publisher = scope.ServiceProvider.GetRequiredService<EventPublisher>();
        foreach (var id in ids) { context.ChangeTracker.Clear(); await publisher.PublishAsync(id, CancellationToken.None); }
    }

    [Fact]
    public async Task ConcurrentRetriesAcrossHostsAreAtomicAndPayloadBound()
    {
        await using var first = Factory();
        await using var second = Factory();
        using var owner = await User(first);
        var community = await Create(owner);
        using var replayClient = second.CreateClient();
        replayClient.DefaultRequestHeaders.Add("Cookie", owner.Cookie);
        using var replay = new Person(replayClient, owner.Profile, owner.Cookie);
        var id = Guid.NewGuid();
        var results = await Task.WhenAll(Send(owner, community, "Exact retry\n<script>safe text</script>", id), Send(replay, community, "Exact retry\n<script>safe text</script>", id));
        Assert.Equal(results[0], results[1]);
        Assert.Equal("1", results[0].Sequence);
        using var conflict = await Command(owner.Client, PathFor(community) + "/messages", new { ClientMessageId = id, Content = "Changed" });
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        using var scope = first.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var channel = Guid.Parse(community.Channels[0].Id);
        Assert.Equal(1, await context.Messages.CountAsync(item => item.ChannelId == channel));
        Assert.Equal(1, await context.ChannelEvents.CountAsync(item => item.ChannelId == channel));
        Assert.Equal(1, await context.OutboxEntries.CountAsync(item => item.Event.ChannelId == channel));
        Assert.Equal(1, (await context.TextChannels.SingleAsync(item => item.Id == channel)).LastSequence);
    }

    [Fact]
    public async Task TwoAuthorsShareOrderedHistoryButThirdAndCrossCommunityIdsAreDenied()
    {
        await using var factory = Factory();
        using var owner = await User(factory); using var member = await User(factory); using var outsider = await User(factory);
        var community = await Create(owner); await Join(owner, member, community);
        var other = await Create(outsider);
        var id = Guid.NewGuid();
        var sent = await Task.WhenAll(Send(owner, community, "Owner text", id), Send(member, community, "Member text", id));
        Assert.Equal(new[] { "1", "2" }, sent.Select(item => item.Sequence).Order().ToArray());
        var history = (await member.Client.GetFromJsonAsync<MessageSnapshot>(PathFor(community) + "/messages"))!;
        Assert.Equal(2, history.Messages.Length); Assert.Equal("2", history.Watermark);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync(PathFor(community) + "/messages")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync(PathFor(community) + "/events?after=0")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(outsider.Client, PathFor(community) + "/messages", new { ClientMessageId = Guid.NewGuid(), Content = "Spoof" })).StatusCode);
        var foreign = $"/api/v1/communities/{community.Id}/channels/{other.Channels[0].Id}/messages";
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(foreign)).StatusCode);
        using var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(PathFor(community) + "/messages")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync(PathFor(community) + "/messages", new { ClientMessageId = Guid.NewGuid(), Content = "Without CSRF" })).StatusCode);
        foreach (var text in new[] { " ", new string('x', 4001), "bad\u0001text" })
            Assert.Equal(HttpStatusCode.BadRequest, (await Command(owner.Client, PathFor(community) + "/messages", new { ClientMessageId = Guid.NewGuid(), Content = text })).StatusCode);
    }

    [Fact]
    public async Task KeysetPagesAndJournalCatchUpHaveConsistentWatermarksAndExpiredCursorReset()
    {
        await using var factory = Factory(); using var owner = await User(factory); var community = await Create(owner);
        using (var scope = factory.Services.CreateScope())
        {
            var service = scope.ServiceProvider.GetRequiredService<MessageService>();
            var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            for (var i = 0; i < 105; i++)
            {
                context.ChangeTracker.Clear();
                await service.SendAsync(Guid.Parse(community.Id), Guid.Parse(community.Channels[0].Id), Guid.Parse(owner.Profile.Id), new(Guid.NewGuid(), $"Page {i}"), CancellationToken.None);
            }
        }
        var latest = (await owner.Client.GetFromJsonAsync<MessageSnapshot>(PathFor(community) + "/messages"))!;
        Assert.Equal(50, latest.Messages.Length); Assert.Equal("56", latest.Messages[0].Sequence); Assert.Equal("105", latest.Watermark); Assert.True(latest.HasOlder);
        var older = (await owner.Client.GetFromJsonAsync<MessageSnapshot>(PathFor(community) + "/messages?before=56"))!;
        Assert.Equal("6", older.Messages[0].Sequence); Assert.Equal("55", older.Messages[^1].Sequence);
        var page = (await owner.Client.GetFromJsonAsync<CatchUpPage>(PathFor(community) + "/events?after=0"))!;
        Assert.Equal(100, page.Events.Length); Assert.True(page.HasMore); Assert.Equal("100", page.NextSequence); Assert.Equal("105", page.Watermark);
        var tail = (await owner.Client.GetFromJsonAsync<CatchUpPage>(PathFor(community) + "/events?after=100"))!;
        Assert.Equal(5, tail.Events.Length); Assert.False(tail.HasMore); Assert.All(tail.Events, item => { Assert.Equal(1, item.SchemaVersion); Assert.Equal("message.created", item.Kind); Assert.Equal(item.Sequence, item.Payload.Sequence); });
        foreach (var cursor in new[] { "-1", "106", "nonsense", "9223372036854775808" })
            Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.GetAsync(PathFor(community) + $"/events?after={cursor}")).StatusCode);
        using var finalScope = factory.Services.CreateScope();
        await finalScope.ServiceProvider.GetRequiredService<AppDbContext>().ChannelEvents.Where(item => item.ChannelId == Guid.Parse(community.Channels[0].Id) && item.Sequence == 100)
            .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.CreatedAt, DateTimeOffset.UtcNow.AddDays(-8)));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.GetAsync(PathFor(community) + "/events?after=100")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.GetAsync(PathFor(community) + "/messages")).StatusCode);
    }

    [Fact]
    public async Task RestartRecoversMessagesAndUnpublishedOutboxWithoutDuplicateCommands()
    {
        string cookie; CommunityDetails community; MessageDto message; var id = Guid.NewGuid();
        await using (var first = Factory())
        {
            using var owner = await User(first); community = await Create(owner); cookie = owner.Cookie;
            message = await Send(owner, community, "Survives restart", id);
        }
        await using var restarted = Factory();
        using var replay = restarted.CreateClient(); replay.DefaultRequestHeaders.Add("Cookie", cookie);
        using var response = await Command(replay, PathFor(community) + "/messages", new { ClientMessageId = id, Content = "Survives restart" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(message, await response.Content.ReadFromJsonAsync<MessageDto>());
        var catchUp = (await replay.GetFromJsonAsync<CatchUpPage>(PathFor(community) + "/events?after=0"))!;
        Assert.Equal(message, Assert.Single(catchUp.Events).Payload);
        await Publish(restarted, community); await Publish(restarted, community);
        using var scope = restarted.Services.CreateScope(); var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.NotNull((await context.OutboxEntries.SingleAsync(item => item.Event.ChannelId == Guid.Parse(community.Channels[0].Id))).PublishedAt);
    }

    private sealed class FailingProxy : IClientProxy
    {
        public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default) => throw new IOException("Synthetic publication failure");
    }
    private sealed class ProxyClients(IClientProxy proxy) : IHubClients
    {
        public IClientProxy All => proxy;
        public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => proxy;
        public IClientProxy Client(string connectionId) => proxy;
        public IClientProxy Clients(IReadOnlyList<string> connectionIds) => proxy;
        public IClientProxy Group(string groupName) => proxy;
        public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => proxy;
        public IClientProxy Groups(IReadOnlyList<string> groupNames) => proxy;
        public IClientProxy User(string userId) => proxy;
        public IClientProxy Users(IReadOnlyList<string> userIds) => proxy;
    }
    private sealed class FailingHub : IHubContext<MessagesHub>
    {
        public IHubClients Clients { get; } = new ProxyClients(new FailingProxy());
        public IGroupManager Groups => throw new NotSupportedException();
    }

    [Fact]
    public async Task PublicationFailureLeavesDurableEntryForRetry()
    {
        await using var factory = Factory(); using var owner = await User(factory); var community = await Create(owner);
        await Send(owner, community, "Persisted before publication failure");
        using var scope = factory.Services.CreateScope(); var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var userId = Guid.Parse(owner.Profile.Id);
        var session = await context.Sessions.Include(item => item.User).SingleAsync(item => item.UserId == userId);
        var connections = factory.Services.GetRequiredService<MessageConnections>();
        Assert.True(connections.Add(new("synthetic-routing-id", userId, session.Id, session.User.SecurityStamp!, Guid.Parse(community.Id), Guid.Parse(community.Channels[0].Id), () => { })));
        var entry = await context.OutboxEntries.SingleAsync(item => item.Event.ChannelId == Guid.Parse(community.Channels[0].Id));
        var failing = new EventPublisher(context, connections, new FailingHub());
        await Assert.ThrowsAsync<IOException>(() => failing.PublishAsync(entry.Id, CancellationToken.None));
        context.ChangeTracker.Clear();
        Assert.Null((await context.OutboxEntries.SingleAsync(item => item.Id == entry.Id)).PublishedAt);
        Assert.Single(await context.Messages.Where(item => item.ChannelId == Guid.Parse(community.Channels[0].Id)).ToArrayAsync());
        await Publish(factory, community);
        context.ChangeTracker.Clear();
        Assert.NotNull((await context.OutboxEntries.SingleAsync(item => item.Id == entry.Id)).PublishedAt);
        connections.Remove("synthetic-routing-id");
    }

    private static async Task Frame(WebSocket socket, object value) => await socket.SendAsync(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value) + "\u001e"), WebSocketMessageType.Text, true, CancellationToken.None);
    private static async Task<JsonElement> Receive(WebSocket socket)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var bytes = new byte[8192];
        var result = await socket.ReceiveAsync(bytes, timeout.Token);
        Assert.Equal(WebSocketMessageType.Text, result.MessageType);
        return JsonDocument.Parse(Encoding.UTF8.GetString(bytes, 0, result.Count).Split('\u001e')[0]).RootElement.Clone();
    }
    private static async Task<WebSocket> Connect(FoundationFactory factory, Person user)
    {
        var client = factory.Server.CreateWebSocketClient();
        client.ConfigureRequest = request => { request.Headers.Origin = "http://localhost"; request.Headers.Cookie = user.Cookie; };
        var socket = await client.ConnectAsync(new Uri("ws://localhost/hubs/messages"), CancellationToken.None);
        await Frame(socket, new { protocol = "json", version = 1 });
        var handshake = await Receive(socket); Assert.False(handshake.TryGetProperty("error", out _));
        return socket;
    }
    private static Task Subscribe(WebSocket socket, CommunityDetails community) => Frame(socket, new { type = 1, invocationId = "1", target = "Subscribe", arguments = new[] { community.Id, community.Channels[0].Id } });

    [Fact]
    public async Task RealHubAuthorizesSubscriptionsAndPublishesOnlyContentFreeHints()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory); using var outsider = await User(factory);
        var community = await Create(owner); await Join(owner, member, community);
        using var denied = await Connect(factory, outsider); await Subscribe(denied, community);
        Assert.True((await Receive(denied)).TryGetProperty("error", out _));
        using var socket = await Connect(factory, member); await Subscribe(socket, community);
        Assert.False((await Receive(socket)).TryGetProperty("error", out _));
        var message = await Send(owner, community, "Private body must never enter a hint");
        await Publish(factory, community);
        var notification = await Receive(socket);
        Assert.Equal("ChannelChanged", notification.GetProperty("target").GetString());
        var hint = notification.GetProperty("arguments")[0];
        Assert.Equal(message.Sequence, hint.GetProperty("sequence").GetString());
        Assert.False(hint.TryGetProperty("payload", out _)); Assert.DoesNotContain(message.Content, notification.ToString());
        Assert.Equal(message, Assert.Single((await member.Client.GetFromJsonAsync<CatchUpPage>(PathFor(community) + "/events?after=0"))!.Events).Payload);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task BanOrLogoutRemovesExistingSubscriptionsBeforeFurtherPublication(bool logout)
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory);
        var community = await Create(owner); await Join(owner, member, community);
        using var socket = await Connect(factory, member); await Subscribe(socket, community); await Receive(socket);
        await Send(owner, community, "Pending publication");
        if (logout) { using var response = await Command(member.Client, "/api/v1/account/logout"); Assert.True(response.IsSuccessStatusCode); }
        else { using var response = await Command(owner.Client, $"/api/v1/communities/{community.Id}/members/{member.Profile.Id}/ban", new { Banned = true }, "PUT"); Assert.True(response.IsSuccessStatusCode); }
        await Publish(factory, community);
        Assert.Empty(factory.Services.GetRequiredService<MessageConnections>().All());
        Assert.Equal(logout ? HttpStatusCode.Unauthorized : HttpStatusCode.NotFound, (await member.Client.GetAsync(PathFor(community) + "/events?after=0")).StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("https://foreign.example")]
    public async Task HubRequiresExplicitSameOriginForAllTransports(string? origin)
    {
        await using var factory = Factory(); using var owner = await User(factory);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/hubs/messages/negotiate?negotiateVersion=1");
        if (origin is not null) request.Headers.Add("Origin", origin);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.Client.SendAsync(request)).StatusCode);
        using var get = new HttpRequestMessage(HttpMethod.Get, "/hubs/messages");
        if (origin is not null) get.Headers.Add("Origin", origin);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.Client.SendAsync(get)).StatusCode);
    }

    [Fact]
    public async Task MessageWaitingBehindBanRereadsAccessAndPersistsNothing()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory);
        var community = await Create(owner); await Join(owner, member, community);
        var token = (await member.Client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!.RequestToken;
        await using var blocker = new NpgsqlConnection(database.Connection); await blocker.OpenAsync(); await using var transaction = await blocker.BeginTransactionAsync();
        await using (var command = new NpgsqlCommand("SELECT 1 FROM \"Communities\" WHERE \"Id\"=@community FOR UPDATE", blocker, transaction))
        { command.Parameters.AddWithValue("community", Guid.Parse(community.Id)); await command.ExecuteScalarAsync(); }
        await using (var command = new NpgsqlCommand("UPDATE \"Memberships\" SET \"Status\"='Banned' WHERE \"CommunityId\"=@community AND \"UserId\"=@user", blocker, transaction))
        { command.Parameters.AddWithValue("community", Guid.Parse(community.Id)); command.Parameters.AddWithValue("user", Guid.Parse(member.Profile.Id)); await command.ExecuteNonQueryAsync(); }
        using var request = new HttpRequestMessage(HttpMethod.Post, PathFor(community) + "/messages") { Content = JsonContent.Create(new { ClientMessageId = Guid.NewGuid(), Content = "Must not persist" }) }; request.Headers.Add("X-CSRF-TOKEN", token);
        var pending = member.Client.SendAsync(request);
        var waiting = false;
        for (var i = 0; i < 30 && !waiting; i++)
        {
            await using var probe = new NpgsqlCommand("SELECT pg_stat_clear_snapshot(); SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%Communities%' AND query LIKE '%FOR UPDATE%')", blocker, transaction);
            await using var reader = await probe.ExecuteReaderAsync(); await reader.NextResultAsync(); await reader.ReadAsync(); waiting = reader.GetBoolean(0);
            if (!waiting) await Task.Delay(25);
        }
        Assert.True(waiting); await transaction.CommitAsync();
        using var response = await pending; Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        using var scope = factory.Services.CreateScope(); var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await context.Messages.AnyAsync(item => item.ChannelId == Guid.Parse(community.Channels[0].Id)));
        Assert.False(await context.ChannelEvents.AnyAsync(item => item.ChannelId == Guid.Parse(community.Channels[0].Id)));
    }
}
