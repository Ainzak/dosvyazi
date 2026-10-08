using System.Text.Json;
using App.Api.Features.Voice;
using Livekit.Server.Sdk.Dotnet;

// Explicit test-only stdio process. No HTTP listener or application backdoor.
using var http = new HttpClient();
var gateway = new LiveKitGateway(http,
    new Uri(Environment.GetEnvironmentVariable("LIVEKIT_URL") ?? "http://127.0.0.1:7880"),
    Environment.GetEnvironmentVariable("LIVEKIT_API_KEY") ?? "",
    Environment.GetEnvironmentVariable("LIVEKIT_API_SECRET") ?? "");
Console.WriteLine("READY");
while (await Console.In.ReadLineAsync() is { } line)
{
    try
    {
        var command = JsonSerializer.Deserialize<Command>(line) ?? throw new ArgumentException();
        var room = new VoiceRoom(command.Room, command.Generation);
        object result = new { ok = true };
        switch (command.Action)
        {
            case "grant": result = gateway.CreateGrant(room, command.Identity, command.CanSpeak); break;
            case "create": await gateway.CreateRoomAsync(room, CancellationToken.None); break;
            case "delete": await gateway.DeleteRoomAsync(room, CancellationToken.None); break;
            case "participants": result = await gateway.ParticipantsAsync(room, CancellationToken.None); break;
            case "remove": await gateway.RemoveParticipantAsync(room, command.Identity, CancellationToken.None); break;
            case "restrict": await gateway.RestrictSpeakingAsync(room, command.Identity, CancellationToken.None); break;
            case "refresh":
                // Test-only metadata update triggers SFU grant refresh. A fresh client
                // and bounded timeout avoid the SDK shared-header concurrency issue.
                using (var refreshHttp = new HttpClient { Timeout = TimeSpan.FromSeconds(2) })
                {
                    var service = new RoomServiceClient(Environment.GetEnvironmentVariable("LIVEKIT_URL"),
                        Environment.GetEnvironmentVariable("LIVEKIT_API_KEY"), Environment.GetEnvironmentVariable("LIVEKIT_API_SECRET"), refreshHttp);
                    await service.UpdateParticipant(new UpdateParticipantRequest
                    { Room = room.Name, Identity = command.Identity.ToString("N"), Name = "Synthetic participant" });
                }
                break;
            default: throw new ArgumentException();
        }
        Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
    catch { Console.WriteLine("{\"error\":\"Voice probe operation failed.\"}"); }
}

internal sealed record Command(string Action, Guid Room, long Generation, Guid Identity, bool CanSpeak);
