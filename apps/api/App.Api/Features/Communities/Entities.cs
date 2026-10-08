using App.Api.Features.Accounts;

namespace App.Api.Features.Communities;

public sealed class Community
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public Guid ClientRequestId { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public long PolicyVersion { get; set; } = 1;
    public ICollection<Membership> Members { get; set; } = [];
    public ICollection<TextChannel> Channels { get; set; } = [];
}

public sealed class Membership
{
    public Guid CommunityId { get; set; }
    public Community Community { get; set; } = null!;
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public string Status { get; set; } = "Active";
    public DateTimeOffset JoinedAt { get; set; }
}

public sealed class TextChannel
{
    public long LastSequence { get; set; }
    public Guid Id { get; set; }
    public Guid CommunityId { get; set; }
    public Community Community { get; set; } = null!;
    public string Name { get; set; } = "general";
}

public sealed class CommunityInvite
{
    public Guid Id { get; set; }
    public Guid CommunityId { get; set; }
    public Community Community { get; set; } = null!;
    public Guid ClientRequestId { get; set; }
    public string CodeHash { get; set; } = string.Empty;
    public string ProtectedCode { get; set; } = string.Empty;
    public int LifetimeHours { get; set; }
    public int MaxUses { get; set; }
    public int Uses { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}
