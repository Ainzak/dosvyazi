namespace App.Api.Features.Voice;

public sealed class VoiceRoomBinding
{
    public Guid CommunityId { get; set; }
    public Guid Id { get; set; }
    public long Generation { get; set; } = 1;
    public string Status { get; set; } = "Ready";
    public Guid? OperationId { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public bool ControlUnavailable { get; set; }
    public DateTimeOffset NextCheckAt { get; set; }
}

public sealed class VoiceLease
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid CommunityId { get; set; }
    public Guid AuthSessionId { get; set; }
    public string SecurityStamp { get; set; } = "";
    public long Generation { get; set; }
    public bool Active { get; set; } = true;
    public DateTimeOffset ExpiresAt { get; set; }
}

public sealed class VoiceGrantRequest
{
    public Guid UserId { get; set; }
    public Guid ClientRequestId { get; set; }
    public Guid LeaseId { get; set; }
    public VoiceLease Lease { get; set; } = null!;
    public string ProtectedToken { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
}

public sealed class RetiredVoiceRoom
{
    public Guid RoomId { get; set; }
    public Guid CommunityId { get; set; }
    public long Generation { get; set; }
    public DateTimeOffset LastCleanupAt { get; set; }
}

public sealed record JoinVoiceRequest(Guid ClientRequestId);
public sealed record VoiceLeaseRequest(Guid LeaseId);
public sealed record VoiceJoinDto(string LeaseId, string Identity, string Generation, string Url, string Token, DateTimeOffset ExpiresAt);
public sealed record VoiceMemberDto(string Identity, string DisplayName, bool SpeakingAllowed, int AudioTracks);
public sealed record VoiceStateDto(string Status, string Generation, string? OperationId, DateTimeOffset? CompletedAt,
    bool ControlUnavailable, string? MyLeaseId, VoiceMemberDto[] Participants);

public sealed class VoiceOptions
{
    public bool Enabled { get; set; }
    public bool WorkerEnabled { get; set; } = true;
    public string ControlUrl { get; set; } = "http://127.0.0.1:7880";
    public string BrowserUrl { get; set; } = "ws://127.0.0.1:7880";
    public string ApiKey { get; set; } = "";
    public string ApiSecret { get; set; } = "";
}
