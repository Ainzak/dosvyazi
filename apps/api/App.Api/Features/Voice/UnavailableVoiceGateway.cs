namespace App.Api.Features.Voice;

public sealed class UnavailableVoiceGateway : IVoiceGateway
{
    public VoiceGrant CreateGrant(VoiceRoom room, Guid identity, bool canSpeak) => throw new VoiceGatewayException();
    public Task CreateRoomAsync(VoiceRoom room, CancellationToken ct) => throw new VoiceGatewayException();
    public Task DeleteRoomAsync(VoiceRoom room, CancellationToken ct) => throw new VoiceGatewayException();
    public Task<IReadOnlyList<VoiceParticipant>> ParticipantsAsync(VoiceRoom room, CancellationToken ct) => throw new VoiceGatewayException();
    public Task RemoveParticipantAsync(VoiceRoom room, Guid identity, CancellationToken ct) => throw new VoiceGatewayException();
    public Task RestrictSpeakingAsync(VoiceRoom room, Guid identity, CancellationToken ct) => throw new VoiceGatewayException();
}
