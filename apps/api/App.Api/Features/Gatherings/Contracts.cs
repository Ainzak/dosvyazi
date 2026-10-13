using System.ComponentModel.DataAnnotations;
namespace App.Api.Features.Gatherings;
public sealed record GatheringPlanRequest(Guid ClientRequestId, [Required] string ExpectedVersion,
    [StringLength(80)] string Title, [StringLength(2000)] string Description, [StringLength(80)] string Game,
    [Required, StringLength(16)] string LocalStart, [Required, StringLength(100)] string TimeZoneId, Guid[] Participants);
public sealed record GatheringResponseRequest(Guid ClientRequestId, int ExpectedRevision, [Required] string State, [StringLength(2000)] string Comment = "");
public sealed record GatheringCommentRequest(Guid ClientRequestId, int ExpectedRevision, [Required, StringLength(2000)] string Text);
public sealed record GatheringStatusRequest(Guid ClientRequestId, [Required] string ExpectedVersion, [Required] string Status);
public sealed record GatheringCoverRequest(Guid ClientRequestId, [Required] string ExpectedVersion);
public sealed record GatheringInviteDto(string UserId, string Name, string State, bool CurrentMember);
public sealed record GatheringCommentDto(string Id, string AuthorId, string AuthorName, int Revision, string Text, DateTimeOffset CreatedAt);
public sealed record GatheringRevisionDto(int Revision, string PlanJson, string ResponsesJson);
public sealed record GatheringDto(string Id, string CommunityId, string OrganizerId, string OrganizerName, string Title, string Description,
    string Game, string LocalStart, string TimeZoneId, DateTimeOffset StartAt, string Status, int Revision, string Version, string? CoverId,
    bool CanManage, bool CanRespond, GatheringInviteDto[] Invites, GatheringCommentDto[] Comments);
public sealed record GatheringList(GatheringDto[] Items, bool HasMore, int NextOffset);
public sealed record GatheringCandidate(string Id, string Name);
public sealed record GatheringCandidates(GatheringCandidate[] Items, bool HasMore, int NextOffset);
public sealed record GatheringNoticeDto(string Id, string GatheringId, string Kind, int Revision, string Version, DateTimeOffset CreatedAt, bool Seen);
public sealed record GatheringNotices(GatheringNoticeDto[] Items, bool HasMore, int NextOffset);
