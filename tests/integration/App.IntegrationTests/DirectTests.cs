using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using App.Api.Features.Accounts;
using App.Api.Features.DirectMessages;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Microsoft.AspNetCore.SignalR;

namespace App.IntegrationTests;

[Trait("Category", "PostgreSQL")]
public sealed class DirectTests(AccountsDatabase storage) : IClassFixture<AccountsDatabase>
{
    private const string Root = "/api/v1/direct-messages";
    private FoundationFactory Factory() => new(connection: storage.Connection, permitLimit: 120);
    private static async Task<HttpResponseMessage> Command(HttpClient client, string path, object? body = null, string method = "POST")
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        request.Headers.Add("X-CSRF-TOKEN", (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!.RequestToken);
        if (body is not null) request.Content = JsonContent.Create(body); return await client.SendAsync(request);
    }
    private static async Task<UserProfile> Register(HttpClient client)
    {
        using var response = await Command(client, "/api/v1/account/register", new { Email = $"dm-{Guid.NewGuid():N}@example.test", Password = "Synthetic direct message 42", DisplayName = "DM member" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode); return (await response.Content.ReadFromJsonAsync<UserProfile>())!;
    }
    private static async Task<DirectConversationDto> Start(HttpClient client, string user)
    {
        using var response = await Command(client, Root, new StartDirectRequest(Guid.NewGuid(), Guid.Parse(user)));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode); return (await response.Content.ReadFromJsonAsync<DirectConversationDto>())!;
    }
    private static async Task<DirectMessageDto> Send(HttpClient client, string conversation, string text, Guid? id = null)
    {
        using var response = await Command(client, Root + $"/{conversation}/messages", new SendMessageRequest(id ?? Guid.NewGuid(), text));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode); return (await response.Content.ReadFromJsonAsync<DirectMessageDto>())!;
    }
    private static async Task<HttpResponseMessage> Upload(HttpClient client, string conversation, Guid id, bool voice = false)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, Root + $"/{conversation}/" + (voice ? "voice-messages" : "attachments"));
        request.Headers.Add("X-CSRF-TOKEN", (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!.RequestToken);
        var form = new MultipartFormDataContent(); form.Add(new StringContent(id.ToString()), "clientMessageId");
        form.Add(new ByteArrayContent(voice ? VoiceMessageMediaTests.Recording(10) : "Synthetic private file"u8.ToArray()), "file", voice ? "voice.webm" : "notes.txt"); request.Content = form;
        return await client.SendAsync(request);
    }
    private static async Task<string> LoginCookie(HttpClient client, UserProfile profile)
    {
        using var response = await Command(client, "/api/v1/account/login", new { profile.Email, Password = "Synthetic direct message 42" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return response.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith("dosvyazi.session=", StringComparison.Ordinal)).Split(';')[0];
    }
    private static async Task<WebSocket> Connect(FoundationFactory host, string cookie)
    {
        var client = host.Server.CreateWebSocketClient(); client.ConfigureRequest = request => { request.Headers.Origin = "http://localhost"; request.Headers.Cookie = cookie; };
        var socket = await client.ConnectAsync(new Uri("ws://localhost/hubs/direct-messages"), CancellationToken.None);
        await socket.SendAsync(Encoding.UTF8.GetBytes("{\"protocol\":\"json\",\"version\":1}\u001e"), WebSocketMessageType.Text, true, CancellationToken.None);
        await Receive(socket); return socket;
    }
    private static async Task Subscribe(WebSocket socket, string? conversation)
    {
        var payload = JsonSerializer.Serialize(new { type = 1, invocationId = "1", target = "Subscribe", arguments = new[] { conversation } }) + '\u001e';
        await socket.SendAsync(Encoding.UTF8.GetBytes(payload), WebSocketMessageType.Text, true, CancellationToken.None);
    }
    private static async Task<JsonElement> Receive(WebSocket socket)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5)); var buffer = new byte[16384];
        var response = await socket.ReceiveAsync(buffer, timeout.Token); return JsonDocument.Parse(Encoding.UTF8.GetString(buffer, 0, response.Count).TrimEnd('\u001e')).RootElement.Clone();
    }
    private static async Task Publish(FoundationFactory host, string conversation)
    {
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var publisher = scope.ServiceProvider.GetRequiredService<DirectPublisher>();
        var ids = await db.DirectEvents.Where(e => e.ConversationId == Guid.Parse(conversation) && e.PublishedAt == null).OrderBy(e => e.Sequence).Select(e => e.Id).ToArrayAsync();
        foreach (var id in ids) { db.ChangeTracker.Clear(); await publisher.PublishAsync(id, default); }
    }
    [Fact]
    public async Task RealHubRejectsThirdParticipantPublishesOnlyHintsAndRevokedSessionsAreAborted()
    {
        await using var host = Factory(); using var first = host.CreateClient(); using var second = host.CreateClient(); using var third = host.CreateClient();
        await Register(first); var peer = await Register(second); var outsider = await Register(third); var conversation = await Start(first, peer.Id); await Publish(host, conversation.Id);
        var thirdCookie = await LoginCookie(third, outsider); using var rejected = await Connect(host, thirdCookie); await Subscribe(rejected, conversation.Id); Assert.True((await Receive(rejected)).TryGetProperty("error", out _));
        var cookie = await LoginCookie(second, peer); using var socket = await Connect(host, cookie); await Subscribe(socket, conversation.Id); Assert.False((await Receive(socket)).TryGetProperty("error", out _));
        var message = await Send(first, conversation.Id, "Private DM body never enters a hint"); await Publish(host, conversation.Id);
        var hint = await Receive(socket); Assert.Equal("DirectChanged", hint.GetProperty("target").GetString()); Assert.DoesNotContain(message.Content, hint.ToString());
        Assert.Equal(conversation.Id, hint.GetProperty("arguments")[0].GetProperty("conversationId").GetString());
        await Send(first, conversation.Id, "Pending publication after logout"); await Command(second, "/api/v1/account/logout"); await Publish(host, conversation.Id);
        Assert.Empty(host.Services.GetRequiredService<DirectConnections>().All());
        using var copied = host.CreateClient(); copied.DefaultRequestHeaders.Add("Cookie", cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await copied.GetAsync(Root + $"/{conversation.Id}/messages")).StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("https://foreign.example")]
    public async Task HubRequiresSameOriginAndMutationsRequireCsrf(string? origin)
    {
        await using var host = Factory(); using var client = host.CreateClient(); await Register(client);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/hubs/direct-messages/negotiate?negotiateVersion=1"); if (origin is not null) request.Headers.Add("Origin", origin);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(request)).StatusCode);
    }
    [Fact]
    public async Task UnrelatedAccountsCanStartOneUniquePairAndThirdAccountCannotReadOrMutate()
    {
        await using var host = Factory(); using var first = host.CreateClient(); using var second = host.CreateClient(); using var third = host.CreateClient();
        var a = await Register(first); var b = await Register(second); var outsider = await Register(third);
        var command = new StartDirectRequest(Guid.NewGuid(), Guid.Parse(b.Id));
        var responses = await Task.WhenAll(Command(first, Root, command), Command(first, Root, command), Command(second, Root, new StartDirectRequest(Guid.NewGuid(), Guid.Parse(a.Id))));
        var conversations = new List<DirectConversationDto>(); foreach (var response in responses) { Assert.Equal(HttpStatusCode.Created, response.StatusCode); conversations.Add((await response.Content.ReadFromJsonAsync<DirectConversationDto>())!); response.Dispose(); }
        Assert.Single(conversations.Select(c => c.Id).Distinct()); var c = conversations[0];
        Assert.Equal(HttpStatusCode.Conflict, (await Command(first, Root, command with { UserId = Guid.Parse(outsider.Id) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await first.PostAsJsonAsync(Root, command)).StatusCode);
        using var anonymous = host.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Root)).StatusCode);
        foreach (var path in new[] { $"/{c.Id}", $"/{c.Id}/messages", $"/{c.Id}/events?after=0" }) Assert.Equal(HttpStatusCode.NotFound, (await third.GetAsync(Root + path)).StatusCode);
        Assert.Empty((await third.GetFromJsonAsync<DirectInbox>(Root))!.Conversations);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(third, Root + $"/{c.Id}/messages", new SendMessageRequest(Guid.NewGuid(), "Forbidden"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Command(third, Root + $"/{c.Id}/block", new BlockDirectRequest(Guid.NewGuid(), true), "PUT")).StatusCode);
        var messages = await Task.WhenAll(Send(first, c.Id, "First peer"), Send(second, c.Id, "Second peer"));
        Assert.Equal(new[] { "1", "2" }, messages.Select(m => m.Sequence).Order().ToArray());
        var history = (await second.GetFromJsonAsync<DirectSnapshot>(Root + $"/{c.Id}/messages"))!; Assert.Equal(2, history.Messages.Length); Assert.Equal("2", history.Watermark);
        using var scope = host.Services.CreateScope(); var actor = Guid.Parse(a.Id);
        Assert.Single(await scope.ServiceProvider.GetRequiredService<AppDbContext>().DirectConversations.Where(item => item.LowerUserId == actor || item.UpperUserId == actor).ToArrayAsync());
    }
    [Fact]
    public async Task BlockingStopsBothDirectionsAndUploadsPreservesHistoryAndOldRetryCannotUnblock()
    {
        await using var host = Factory(); using var first = host.CreateClient(); using var second = host.CreateClient();
        await Register(first); var other = await Register(second); var c = await Start(first, other.Id); var original = await Send(first, c.Id, "Keep earlier history");
        var block = new BlockDirectRequest(Guid.NewGuid(), true); var path = Root + $"/{c.Id}";
        Assert.Equal(HttpStatusCode.OK, (await Command(second, path + "/block", block, "PUT")).StatusCode);
        foreach (var client in new[] { first, second })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await Command(client, path + "/messages", new SendMessageRequest(Guid.NewGuid(), "Cannot bypass block"))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Upload(client, c.Id, Guid.NewGuid())).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Upload(client, c.Id, Guid.NewGuid(), true)).StatusCode);
            Assert.Single((await client.GetFromJsonAsync<DirectSnapshot>(path + "/messages"))!.Messages);
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(first, path + $"/messages/{original.Id}", new EditMessageRequest(Guid.NewGuid(), "1", "Cannot edit around block"), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(second, path + "/block", new BlockDirectRequest(Guid.NewGuid(), false), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(second, path + "/block", block, "PUT")).StatusCode);
        Assert.False((await second.GetFromJsonAsync<DirectConversationDto>(path))!.ContactUnavailable);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(second, path + "/block", block with { Blocked = false }, "PUT")).StatusCode);
        await Send(first, c.Id, "Contact resumed");
    }
    [Fact]
    public async Task PrivateMediaAndAuthorChangesFollowParticipationAndDeletion()
    {
        await using var host = Factory(); using var first = host.CreateClient(); using var second = host.CreateClient(); using var third = host.CreateClient();
        await Register(first); var other = await Register(second); await Register(third); var c = await Start(first, other.Id); var path = Root + $"/{c.Id}";
        foreach (var voice in new[] { false, true })
        {
            var id = Guid.NewGuid(); using var response = await Upload(first, c.Id, id, voice); Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            var message = (await response.Content.ReadFromJsonAsync<DirectMessageDto>())!;
            using var retry = await Upload(first, c.Id, id, voice); Assert.Equal(message.Id, (await retry.Content.ReadFromJsonAsync<DirectMessageDto>())!.Id);
            var url = path + "/attachments/" + message.Attachment!.Id;
            Assert.Equal(HttpStatusCode.OK, (await second.GetAsync(url)).StatusCode); Assert.Equal(HttpStatusCode.NotFound, (await third.GetAsync(url)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await Upload(third, c.Id, Guid.NewGuid(), voice)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Command(second, path + $"/messages/{message.Id}/delete", new DeleteDirectRequest(Guid.NewGuid(), "1"))).StatusCode);
            using var edit = await Command(first, path + $"/messages/{message.Id}", new EditMessageRequest(Guid.NewGuid(), "1", "Edited caption"), "PUT"); Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await Command(first, path + $"/messages/{message.Id}/delete", new DeleteDirectRequest(Guid.NewGuid(), "1"))).StatusCode);
            var delete = new DeleteDirectRequest(Guid.NewGuid(), "2"); Assert.Equal(HttpStatusCode.OK, (await Command(first, path + $"/messages/{message.Id}/delete", delete)).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await Command(first, path + $"/messages/{message.Id}/delete", delete)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await second.GetAsync(url)).StatusCode);
        }
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await AttachmentCleanup.PurgeAsync(db, scope.ServiceProvider.GetRequiredService<AttachmentStore>(), default);
        Assert.All(await db.DirectAttachments.Where(a => a.Message.ConversationId == Guid.Parse(c.Id)).ToArrayAsync(), a => Assert.True(a.Purged));
        Assert.Empty((await first.GetFromJsonAsync<DirectSnapshot>(path + "/messages"))!.Messages);
    }
    [Fact]
    public async Task UnreadAndRecoveryArePersonalAndRevokedSessionsCannotReturn()
    {
        await using var host = Factory(); using var first = host.CreateClient(); using var second = host.CreateClient();
        await Register(first); var b = await Register(second); var c = await Start(first, b.Id); var path = Root + $"/{c.Id}";
        var id = Guid.NewGuid(); var message = await Send(first, c.Id, "One delivered message", id); Assert.Equal(message, await Send(first, c.Id, "One delivered message", id));
        Assert.Equal(HttpStatusCode.Conflict, (await Command(first, path + "/messages", new SendMessageRequest(id, "Changed"))).StatusCode);
        Assert.Equal(1, (await second.GetFromJsonAsync<DirectConversationDto>(path))!.Unread); Assert.Equal(0, (await first.GetFromJsonAsync<DirectConversationDto>(path))!.Unread);
        Assert.Equal(HttpStatusCode.OK, (await Command(second, path + "/read", new DirectReadRequest("1"), "PUT")).StatusCode); Assert.Equal(0, (await second.GetFromJsonAsync<DirectConversationDto>(path))!.Unread);
        Assert.Equal(HttpStatusCode.BadRequest, (await Command(second, path + "/read", new DirectReadRequest("2"), "PUT")).StatusCode);
        Assert.Single((await second.GetFromJsonAsync<DirectCatchUp>(path + "/events?after=0"))!.Events); Assert.Equal(HttpStatusCode.BadRequest, (await second.GetAsync(path + "/events?after=2")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Command(second, "/api/v1/account/logout")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await second.GetAsync(path + "/messages")).StatusCode);
    }
    [Fact]
    public async Task InboxAndMessagePagesStayBoundedAndForeignCursorsCannotEnumerate()
    {
        await using var host = Factory(); using var first = host.CreateClient(); using var second = host.CreateClient();
        var actor = await Register(first); var other = await Register(second); var actorId = Guid.Parse(actor.Id);
        using (var scope = host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var now = DateTimeOffset.UtcNow;
            for (var index = 0; index < 51; index++)
            {
                var user = Guid.NewGuid(); db.Users.Add(new AppUser { Id = user, DisplayName = "Synthetic inbox peer", Email = $"page-{user:N}@example.test", NormalizedEmail = $"PAGE-{user:N}@EXAMPLE.TEST" });
                var lower = string.CompareOrdinal(actorId.ToString("N"), user.ToString("N")) < 0 ? actorId : user;
                db.DirectConversations.Add(new() { Id = Guid.NewGuid(), LowerUserId = lower, UpperUserId = lower == actorId ? user : actorId, UpdatedAt = now });
            }
            await db.SaveChangesAsync();
        }
        var page = (await first.GetFromJsonAsync<DirectInbox>(Root))!; Assert.Equal(50, page.Conversations.Length); Assert.True(page.HasMore); Assert.NotNull(page.Before);
        var tail = (await first.GetFromJsonAsync<DirectInbox>(Root + $"?before={page.Before}"))!; Assert.Single(tail.Conversations); Assert.False(tail.HasMore);
        Assert.Equal(HttpStatusCode.NotFound, (await second.GetAsync(Root + $"?before={page.Before}")).StatusCode);
        var conversation = await Start(first, other.Id); var id = Guid.Parse(conversation.Id);
        using (var scope = host.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var row = await db.DirectConversations.SingleAsync(c => c.Id == id); var now = DateTimeOffset.UtcNow;
            for (var index = 1; index <= 105; index++)
            {
                var message = Guid.NewGuid(); db.DirectMessages.Add(new() { Id = message, ConversationId = id, AuthorId = actorId, ClientMessageId = Guid.NewGuid(), Content = $"Synthetic page {index}", Sequence = index, CreatedAt = now });
                db.DirectEvents.Add(new() { Id = Guid.NewGuid(), ConversationId = id, MessageId = message, Sequence = index, CreatedAt = now });
            }
            row.Sequence = 105; await db.SaveChangesAsync();
        }
        var history = (await first.GetFromJsonAsync<DirectSnapshot>(Root + $"/{id}/messages"))!; Assert.Equal(50, history.Messages.Length); Assert.Equal("56", history.Messages[0].Sequence); Assert.True(history.HasOlder);
        var older = (await first.GetFromJsonAsync<DirectSnapshot>(Root + $"/{id}/messages?before=56"))!; Assert.Equal("6", older.Messages[0].Sequence); Assert.Equal("55", older.Messages[^1].Sequence);
        var events = (await first.GetFromJsonAsync<DirectCatchUp>(Root + $"/{id}/events?after=0"))!; Assert.Equal(100, events.Events.Length); Assert.True(events.HasMore); Assert.Equal("100", events.NextSequence);
        Assert.Equal(5, (await first.GetFromJsonAsync<DirectCatchUp>(Root + $"/{id}/events?after=100"))!.Events.Length);
        using var finalScope = host.Services.CreateScope(); await finalScope.ServiceProvider.GetRequiredService<AppDbContext>().DirectEvents.Where(e => e.ConversationId == id && e.Sequence == 100).ExecuteUpdateAsync(update => update.SetProperty(e => e.CreatedAt, DateTimeOffset.UtcNow.AddDays(-8)));
        Assert.Equal(HttpStatusCode.Conflict, (await first.GetAsync(Root + $"/{id}/events?after=100")).StatusCode);
    }
    [Fact]
    public async Task SendWaitingBehindBlockCannotPublishAndStartRateIsBounded()
    {
        await using var host = Factory(); using var first = host.CreateClient(); using var second = host.CreateClient();
        var a = await Register(first); var b = await Register(second); var conversation = await Start(first, b.Id);
        var csrf = (await first.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!.RequestToken;
        await using var blocker = new NpgsqlConnection(storage.Connection); await blocker.OpenAsync(); await using var tx = await blocker.BeginTransactionAsync();
        await using (var command = new NpgsqlCommand("SELECT 1 FROM \"AspNetUsers\" WHERE \"Id\"=@first OR \"Id\"=@second ORDER BY \"Id\" FOR UPDATE", blocker, tx))
        { command.Parameters.AddWithValue("first", Guid.Parse(a.Id)); command.Parameters.AddWithValue("second", Guid.Parse(b.Id)); await command.ExecuteNonQueryAsync(); }
        await using (var command = new NpgsqlCommand("INSERT INTO \"UserBlocks\" (\"UserId\", \"BlockedUserId\", \"CreatedAt\") VALUES (@user,@blocked,now())", blocker, tx))
        { command.Parameters.AddWithValue("user", Guid.Parse(b.Id)); command.Parameters.AddWithValue("blocked", Guid.Parse(a.Id)); await command.ExecuteNonQueryAsync(); }
        using var request = new HttpRequestMessage(HttpMethod.Post, Root + $"/{conversation.Id}/messages") { Content = JsonContent.Create(new SendMessageRequest(Guid.NewGuid(), "Must not persist after blocking")) }; request.Headers.Add("X-CSRF-TOKEN", csrf);
        var pending = first.SendAsync(request); var waiting = false;
        for (var index = 0; index < 40 && !waiting; index++)
        {
            await using var probe = new NpgsqlCommand("SELECT pg_stat_clear_snapshot(); SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation = '\"AspNetUsers\"'::regclass AND NOT granted)", blocker, tx);
            await using var reader = await probe.ExecuteReaderAsync(); await reader.NextResultAsync(); await reader.ReadAsync(); waiting = reader.GetBoolean(0);
            // Tuple/transaction locks may be reported through pg_stat_activity rather than relation locks.
            if (!waiting)
            {
                await reader.DisposeAsync(); await using var activity = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%AspNetUsers%' AND query LIKE '%FOR UPDATE%')", blocker, tx);
                waiting = (bool)(await activity.ExecuteScalarAsync())!;
            }
            if (!waiting) await Task.Delay(25);
        }
        Assert.True(waiting); await tx.CommitAsync(); using var response = await pending; Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Empty((await first.GetFromJsonAsync<DirectSnapshot>(Root + $"/{conversation.Id}/messages"))!.Messages);
        // Existing-pair starts return the same conversation; the 13th attempt is still rate limited.
        for (var index = 0; index < 11; index++) Assert.Equal(HttpStatusCode.Created, (await Command(first, Root, new StartDirectRequest(Guid.NewGuid(), Guid.Parse(b.Id)))).StatusCode);
        using var limited = await Command(first, Root, new StartDirectRequest(Guid.NewGuid(), Guid.Parse(b.Id))); Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal("60", limited.Headers.GetValues("Retry-After").Single());
    }
    private sealed class TestProxy(bool stalled) : IClientProxy
    {
        public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default) => stalled ? Task.Delay(Timeout.Infinite, cancellationToken) : throw new IOException("Synthetic delivery failure");
    }
    private sealed class TestClients(IClientProxy proxy) : IHubClients
    {
        public IClientProxy All => proxy;
        public IClientProxy AllExcept(IReadOnlyList<string> ids) => proxy;
        public IClientProxy Client(string id) => proxy;
        public IClientProxy Clients(IReadOnlyList<string> ids) => proxy;
        public IClientProxy Group(string name) => proxy;
        public IClientProxy GroupExcept(string name, IReadOnlyList<string> ids) => proxy;
        public IClientProxy Groups(IReadOnlyList<string> names) => proxy;
        public IClientProxy User(string id) => proxy;
        public IClientProxy Users(IReadOnlyList<string> ids) => proxy;
    }
    private sealed class TestHub(bool stalled) : IHubContext<DirectHub>
    {
        public IHubClients Clients { get; } = new TestClients(new TestProxy(stalled));
        public IGroupManager Groups => throw new NotSupportedException();
    }
    [Fact]
    public async Task FailedDeliveryRemainsDurableAndStalledClientIsRemovedWithoutHoldingAccountLocks()
    {
        await using var host = Factory(); using var first = host.CreateClient(); using var second = host.CreateClient();
        var actor = await Register(first); var peer = await Register(second); var conversation = await Start(first, peer.Id); await Publish(host, conversation.Id);
        var sent = await Send(first, conversation.Id, "Retain until retry");
        using var scope = host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var actorId = Guid.Parse(actor.Id); var session = await db.Sessions.Include(s => s.User).SingleAsync(s => s.UserId == actorId);
        var aborted = false; var connections = host.Services.GetRequiredService<DirectConnections>();
        Assert.True(connections.Add(new("synthetic-direct-transport", actorId, session.Id, session.User.SecurityStamp!, Guid.Parse(conversation.Id), () => aborted = true)));
        var item = await db.DirectEvents.SingleAsync(e => e.MessageId == Guid.Parse(sent.Id));
        await Assert.ThrowsAsync<IOException>(() => new DirectPublisher(db, connections, new TestHub(false)).PublishAsync(item.Id, default));
        db.ChangeTracker.Clear(); Assert.Null((await db.DirectEvents.SingleAsync(e => e.Id == item.Id)).PublishedAt);
        await new DirectPublisher(db, connections, new TestHub(true)).PublishAsync(item.Id, default);
        db.ChangeTracker.Clear(); Assert.NotNull((await db.DirectEvents.SingleAsync(e => e.Id == item.Id)).PublishedAt); Assert.True(aborted); Assert.Empty(connections.All());
        // A subsequent write completes after the timed-out hint, and history still has the original content.
        await Send(first, conversation.Id, "After transport timeout"); Assert.Equal(2, (await first.GetFromJsonAsync<DirectSnapshot>(Root + $"/{conversation.Id}/messages"))!.Messages.Length);
    }
    [Fact]
    public async Task RestartRetainsVoiceMediaAndCopiedSessionRetriesWithoutDuplicates()
    {
        string cookie; DirectConversationDto conversation; DirectMessageDto message; var requestId = Guid.NewGuid();
        await using (var host = Factory())
        {
            using var first = host.CreateClient(); using var second = host.CreateClient(); var actor = await Register(first); var peer = await Register(second);
            cookie = await LoginCookie(first, actor); conversation = await Start(first, peer.Id);
            using var response = await Upload(first, conversation.Id, requestId, true); Assert.Equal(HttpStatusCode.Created, response.StatusCode); message = (await response.Content.ReadFromJsonAsync<DirectMessageDto>())!;
        }
        await using var restarted = Factory(); using var copied = restarted.CreateClient(); copied.DefaultRequestHeaders.Add("Cookie", cookie);
        using var retry = await Upload(copied, conversation.Id, requestId, true); Assert.Equal(HttpStatusCode.Created, retry.StatusCode); Assert.Equal(message, await retry.Content.ReadFromJsonAsync<DirectMessageDto>());
        using var file = await copied.GetAsync(Root + $"/{conversation.Id}/attachments/{message.Attachment!.Id}"); Assert.Equal(HttpStatusCode.OK, file.StatusCode); Assert.Equal(200, VoiceMessageMedia.Validate(await file.Content.ReadAsByteArrayAsync()).DurationMs);
        Assert.Single((await copied.GetFromJsonAsync<DirectSnapshot>(Root + $"/{conversation.Id}/messages"))!.Messages);
        await Publish(restarted, conversation.Id); using var scope = restarted.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.All(await db.DirectEvents.Where(e => e.ConversationId == Guid.Parse(conversation.Id)).ToArrayAsync(), e => Assert.NotNull(e.PublishedAt));
    }
}
