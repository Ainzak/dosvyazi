namespace App.Api.Features.Communities;

public sealed class CommunityRole
{
    public Guid Id { get; set; }
    public Guid CommunityId { get; set; }
    public string Name { get; set; } = "";
    public int Grants { get; set; }
    public int Rank { get; set; }
}

public sealed class Category
{
    public Guid Id { get; set; }
    public Guid CommunityId { get; set; }
    public string Name { get; set; } = "";
}

public sealed class MemberRole
{
    public Guid CommunityId { get; set; }
    public Guid UserId { get; set; }
    public Guid RoleId { get; set; }
}

public sealed class CategoryRoleRule
{
    public Guid CommunityId { get; set; }
    public Guid CategoryId { get; set; }
    public Guid RoleId { get; set; }
    public int Allow { get; set; }
    public int Deny { get; set; }
}

public sealed class ChannelRoleRule
{
    public Guid CommunityId { get; set; }
    public Guid ChannelId { get; set; }
    public Guid RoleId { get; set; }
    public int Allow { get; set; }
    public int Deny { get; set; }
}

// Durable command receipt, scoped to a community, contains no message bodies.
public sealed class AccessChange
{
    public Guid CommunityId { get; set; }
    public Guid ClientRequestId { get; set; }
    public Guid ActorId { get; set; }
    public string Hash { get; set; } = "";
    public long ResultVersion { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class VoiceRoleRule
{
    public Guid CommunityId { get; set; }
    public Guid RoleId { get; set; }
    public int Allow { get; set; }
    public int Deny { get; set; }
}

public sealed class AuditEntry
{
    public Guid Id { get; set; }
    public Guid CommunityId { get; set; }
    public Guid ActorId { get; set; }
    public string Action { get; set; } = "";
    public Guid TargetId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
