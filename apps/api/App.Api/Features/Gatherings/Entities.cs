namespace App.Api.Features.Gatherings;

public sealed class Gathering
{
    public Guid Id { get; set; }
    public Guid CommunityId { get; set; }
    public Guid OrganizerId { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Game { get; set; } = "";
    public string LocalStart { get; set; } = "";
    public string TimeZoneId { get; set; } = "";
    public DateTimeOffset StartAt { get; set; }
    public string Status { get; set; } = "Scheduled";
    public int Revision { get; set; } = 1;
    public long Version { get; set; } = 1;
    public Guid? CoverId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public List<GatheringInvite> Invites { get; set; } = [];
}
public sealed class GatheringInvite
{
    public Guid GatheringId { get; set; }
    public Gathering Gathering { get; set; } = null!;
    public Guid UserId { get; set; }
    public bool Active { get; set; } = true;
    public string State { get; set; } = "Pending";
}
public sealed class GatheringComment
{
    public Guid Id { get; set; }
    public Guid GatheringId { get; set; }
    public Guid AuthorId { get; set; }
    public int Revision { get; set; }
    public long Sequence { get; set; }
    public string Text { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class GatheringRevision
{
    public Guid GatheringId { get; set; }
    public int Revision { get; set; }
    public string PlanJson { get; set; } = "";
    public string ResponsesJson { get; set; } = "";
}
public sealed class GatheringCommand
{
    public Guid CommunityId { get; set; }
    public Guid ActorId { get; set; }
    public Guid ClientRequestId { get; set; }
    public Guid GatheringId { get; set; }
    public string Hash { get; set; } = "";
}
public sealed class GatheringNotice
{
    public Guid Id { get; set; }
    public Guid GatheringId { get; set; }
    public Guid UserId { get; set; }
    public string Kind { get; set; } = "";
    public int Revision { get; set; }
    public long Version { get; set; }
    public bool Seen { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
// Durable outbox hints; HTTP remains the authorized source of truth.
public sealed class GatheringEvent
{
    public Guid Id { get; set; }
    public Guid GatheringId { get; set; }
    public Guid CommunityId { get; set; }
    public long Version { get; set; }
    public string RemovedUsersJson { get; set; } = "[]";
    public DateTimeOffset? PublishedAt { get; set; }
}
public sealed class GatheringCover
{
    public Guid Id { get; set; }
    public Guid GatheringId { get; set; }
    public string ContentType { get; set; } = "";
    public bool Retired { get; set; }
    public bool Purged { get; set; }
}
