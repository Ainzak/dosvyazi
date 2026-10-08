using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Text;
using System.Text.Json;
using App.Api.Features.Voice;

namespace App.IntegrationTests;

public sealed class VoiceGatewayTests
{
    private const string Secret = "synthetic_test_secret_32_characters_minimum";

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void GrantsAreRoomScopedShortLivedAndNeverAdministrative(bool canSpeak)
    {
        using var http = new HttpClient();
        var gateway = new LiveKitGateway(http, new Uri("http://127.0.0.1:7880"), "test_key", Secret);
        var room = new VoiceRoom(Guid.NewGuid(), 2);
        var identity = Guid.NewGuid();
        var grant = gateway.CreateGrant(room, identity, canSpeak);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(grant.Token);
        using var video = JsonDocument.Parse(jwt.Claims.Single(c => c.Type == "video").Value);
        var permissions = video.RootElement;
        Assert.Equal(identity.ToString("N"), jwt.Subject);
        Assert.Equal(room.Name, permissions.GetProperty("room").GetString());
        Assert.True(permissions.GetProperty("roomJoin").GetBoolean());
        Assert.False(permissions.GetProperty("roomAdmin").GetBoolean());
        Assert.False(permissions.GetProperty("roomCreate").GetBoolean());
        Assert.False(permissions.GetProperty("roomList").GetBoolean());
        Assert.False(permissions.GetProperty("canPublishData").GetBoolean());
        Assert.False(permissions.GetProperty("canUpdateOwnMetadata").GetBoolean());
        Assert.True(permissions.GetProperty("canSubscribe").GetBoolean());
        Assert.Equal(canSpeak, permissions.GetProperty("canPublish").GetBoolean());
        Assert.Equal(canSpeak ? ["microphone"] : Array.Empty<string>(),
            permissions.GetProperty("canPublishSources").EnumerateArray().Select(item => item.GetString()).ToArray());
        Assert.Equal(grant.ExpiresAt.UtcDateTime, jwt.ValidTo);
        Assert.InRange((grant.ExpiresAt - DateTimeOffset.UtcNow).TotalSeconds, 58, 60);
        Assert.Throws<ArgumentException>(() => gateway.CreateGrant(default, identity, true));
        Assert.Throws<ArgumentException>(() => gateway.CreateGrant(room, Guid.Empty, true));
    }

    [Fact]
    public async Task ConcurrentControlRequestsKeepTheirOwnAuthorizationAndRoom()
    {
        var headers = new List<(string Room, string Token)>();
        using var handler = new CallbackHandler(async (request, cancellation) =>
        {
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellation));
            lock (headers) headers.Add((body.RootElement.GetProperty("room").GetString()!, request.Headers.Authorization!.Parameter!));
            await Task.Delay(20, cancellation);
            return Json("{\"participants\":[]}");
        });
        using var http = new HttpClient(handler);
        var gateway = new LiveKitGateway(http, new Uri("http://127.0.0.1:7880"), "test_key", Secret);
        await Task.WhenAll(Enumerable.Range(1, 20).Select(i => gateway.ParticipantsAsync(new VoiceRoom(Guid.NewGuid(), i), CancellationToken.None)));
        Assert.Equal(20, headers.Count);
        Assert.Null(http.DefaultRequestHeaders.Authorization);
        foreach (var header in headers)
        {
            var jwt = new JwtSecurityTokenHandler().ReadJwtToken(header.Token);
            using var permissions = JsonDocument.Parse(jwt.Claims.Single(c => c.Type == "video").Value);
            Assert.Equal(header.Room, permissions.RootElement.GetProperty("room").GetString());
            Assert.True(permissions.RootElement.GetProperty("roomAdmin").GetBoolean());
        }
    }

    [Fact]
    public async Task ControlFailureIsSanitizedAndCancellationIsPropagated()
    {
        using var failure = new CallbackHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
        { Content = new StringContent("private failure details") }));
        using var http = new HttpClient(failure);
        var gateway = new LiveKitGateway(http, new Uri("http://127.0.0.1:7880"), "test_key", Secret);
        var room = new VoiceRoom(Guid.NewGuid(), 1);
        var error = await Assert.ThrowsAsync<VoiceGatewayException>(() => gateway.DeleteRoomAsync(room, CancellationToken.None));
        Assert.Equal("Voice control service is unavailable.", error.Message);
        Assert.Null(error.InnerException);
        using var slow = new CallbackHandler(async (_, cancellation) => { await Task.Delay(Timeout.Infinite, cancellation); return Json("{}"); });
        using var slowHttp = new HttpClient(slow);
        var slowGateway = new LiveKitGateway(slowHttp, new Uri("http://127.0.0.1:7880"), "test_key", Secret);
        await Assert.ThrowsAsync<VoiceGatewayException>(() => slowGateway.DeleteRoomAsync(room, CancellationToken.None));
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => slowGateway.DeleteRoomAsync(room, cancellation.Token));
    }

    private static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK)
    { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private sealed class CallbackHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> callback) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => callback(request, cancellationToken);
    }
}
