namespace App.Api.Features.Voice;

// The caller must check current application authorization before creating a grant.
// The SFU adapter has no knowledge of community membership or application sessions.
public interface IVoiceGateway
{
    VoiceGrant CreateGrant(VoiceRoom room, Guid identity, bool canSpeak);
    Task CreateRoomAsync(VoiceRoom room, CancellationToken cancellationToken);
    Task DeleteRoomAsync(VoiceRoom room, CancellationToken cancellationToken);
    Task<IReadOnlyList<VoiceParticipant>> ParticipantsAsync(VoiceRoom room, CancellationToken cancellationToken);
    Task RemoveParticipantAsync(VoiceRoom room, Guid identity, CancellationToken cancellationToken);
    Task RestrictSpeakingAsync(VoiceRoom room, Guid identity, CancellationToken cancellationToken);
}

public readonly record struct VoiceRoom
{
    public Guid Id { get; }
    public long Generation { get; }
    public string Name => $"vc_{Id:N}_{Generation}";

    public VoiceRoom(Guid id, long generation)
    {
        if (id == Guid.Empty || generation < 1) throw new ArgumentException("Invalid voice room.");
        Id = id;
        Generation = generation;
    }
}

public sealed record VoiceGrant(string Token, DateTimeOffset ExpiresAt);
public sealed record VoiceParticipant(string Identity, bool CanPublish, int AudioTracks);
public sealed class VoiceGatewayException() : Exception("Voice control service is unavailable.");
