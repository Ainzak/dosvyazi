using System.ComponentModel.DataAnnotations;

namespace App.Api.Features.Communities;

public sealed record CreateCommunityRequest(Guid ClientRequestId, [Required, StringLength(80, MinimumLength = 2)] string Name);
public sealed record CreateInviteRequest(Guid ClientRequestId, [Range(1, 168)] int LifetimeHours, [Range(1, 100)] int MaxUses);
public sealed record AcceptInviteRequest([Required, StringLength(64, MinimumLength = 64), RegularExpression("^[a-f0-9]{64}$")] string Code);
public sealed record BanMemberRequest(bool Banned);
public sealed record ChannelSummary(string Id, string Name, string? CategoryName = null, bool CanSend = true, string? SendDeniedBy = null, bool CanManageMessages = false);
public sealed record CommunitySummary(string Id, string Name, string Role);
public sealed record CommunityDetails(string Id, string Name, string OwnerId, string Role, int MemberCount, ChannelSummary[] Channels, int Permissions = 0, int Rank = 0, bool CanViewVoice = true);
public sealed record MemberSummary(string UserId, string DisplayName, string Status, bool IsOwner, int Rank = 0);
public sealed record InviteSummary(string Id, int MaxUses, int Uses, DateTimeOffset ExpiresAt, bool Revoked);
public sealed record CreatedInvite(InviteSummary Invite, string Code);

public sealed class CommunityFailure(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
