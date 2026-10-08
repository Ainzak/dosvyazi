using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Livekit.Server.Sdk.Dotnet;

namespace App.Api.Features.Voice;

public sealed class LiveKitGateway : IVoiceGateway
{
    private readonly HttpClient http;
    private readonly string apiKey;
    private readonly string apiSecret;
    private readonly Uri controlUrl;

    public LiveKitGateway(HttpClient http, Uri controlUrl, string apiKey, string apiSecret)
    {
        if (!controlUrl.IsAbsoluteUri || controlUrl.Scheme is not ("http" or "https") ||
            controlUrl.UserInfo.Length != 0 || controlUrl.Query.Length != 0 || controlUrl.Fragment.Length != 0 ||
            string.IsNullOrWhiteSpace(apiKey) || apiSecret.Length < 32)
            throw new ArgumentException("Invalid voice configuration.");
        this.http = http;
        this.controlUrl = controlUrl;
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
    }

    public VoiceGrant CreateGrant(VoiceRoom room, Guid identity, bool canSpeak)
    {
        Validate(room);
        if (identity == Guid.Empty) throw new ArgumentException("Invalid voice identity.");
        // Integer seconds match JWT precision. Never return an admin grant to a client.
        var expiresAt = DateTimeOffset.FromUnixTimeSeconds(DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 60);
        var token = new AccessToken(apiKey, apiSecret).WithIdentity(identity.ToString("N"))
            .WithExpiration(expiresAt.UtcDateTime).WithGrants(new VideoGrants
            {
                RoomJoin = true, Room = room.Name,
                CanSubscribe = true, CanPublish = canSpeak, CanPublishData = false,
                CanPublishSources = canSpeak ? ["microphone"] : [],
                CanUpdateOwnMetadata = false,
            }).ToJwt();
        return new(token, expiresAt);
    }

    public async Task CreateRoomAsync(VoiceRoom room, CancellationToken cancellationToken)
    {
        using var result = await CallAsync("CreateRoom", room, new
        { name = room.Name, max_participants = 16, empty_timeout = 300, departure_timeout = 20 }, false, cancellationToken);
    }

    public async Task DeleteRoomAsync(VoiceRoom room, CancellationToken cancellationToken)
    {
        using var result = await CallAsync("DeleteRoom", room, new { room = room.Name }, false, cancellationToken);
    }

    public async Task<IReadOnlyList<VoiceParticipant>> ParticipantsAsync(VoiceRoom room, CancellationToken cancellationToken)
    {
        using var result = await CallAsync("ListParticipants", room, new { room = room.Name }, true, cancellationToken);
        var participants = new List<VoiceParticipant>();
        if (!result.RootElement.TryGetProperty("participants", out var items)) return participants;
        foreach (var item in items.EnumerateArray())
        {
            var identity = item.GetProperty("identity").GetString() ?? "";
            var canPublish = item.TryGetProperty("permission", out var permissions) &&
                permissions.TryGetProperty("canPublish", out var publish) && publish.GetBoolean();
            var tracks = item.TryGetProperty("tracks", out var list)
                ? list.EnumerateArray().Count(track => track.TryGetProperty("type", out var type) && type.GetString() == "AUDIO") : 0;
            participants.Add(new(identity, canPublish, tracks));
        }
        return participants;
    }

    public async Task RemoveParticipantAsync(VoiceRoom room, Guid identity, CancellationToken cancellationToken)
    {
        if (identity == Guid.Empty) throw new ArgumentException("Invalid voice identity.");
        using var result = await CallAsync("RemoveParticipant", room,
            new { room = room.Name, identity = identity.ToString("N") }, true, cancellationToken);
    }

    public async Task RestrictSpeakingAsync(VoiceRoom room, Guid identity, CancellationToken cancellationToken)
    {
        if (identity == Guid.Empty) throw new ArgumentException("Invalid voice identity.");
        using var result = await CallAsync("UpdateParticipant", room,
            new { room = room.Name, identity = identity.ToString("N"), permission = new
            { can_publish = false, can_subscribe = true, can_publish_data = false, can_update_metadata = false } }, true, cancellationToken);
    }

    private async Task<JsonDocument> CallAsync(string method, VoiceRoom room, object body, bool roomAdmin, CancellationToken cancellationToken)
    {
        Validate(room);
        // SDK 1.2.3's RoomService client mutates shared DefaultRequestHeaders and
        // exposes no CancellationToken. Use the documented Twirp API with isolated
        // per-request headers, retaining the community SDK for token generation.
        var token = new AccessToken(apiKey, apiSecret).WithTtl(TimeSpan.FromSeconds(60))
            .WithGrants(roomAdmin ? new VideoGrants { RoomAdmin = true, Room = room.Name }
                : new VideoGrants { RoomCreate = true }).ToJwt();
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(controlUrl, $"/twirp/livekit.RoomService/{method}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Content = JsonContent.Create(body);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
        try
        {
            using var response = await http.SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode) throw new VoiceGatewayException();
            return JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { throw new VoiceGatewayException(); }
        catch (HttpRequestException) { throw new VoiceGatewayException(); }
        catch (JsonException) { throw new VoiceGatewayException(); }
    }

    private static void Validate(VoiceRoom room)
    {
        if (room.Id == Guid.Empty || room.Generation < 1) throw new ArgumentException("Invalid voice room.");
    }
}
