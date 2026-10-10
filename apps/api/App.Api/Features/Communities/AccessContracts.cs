using System.ComponentModel.DataAnnotations;

namespace App.Api.Features.Communities;

public sealed record RolePolicy(Guid Id, [Required, StringLength(80)] string Name, [Range(0, 16383)] int Grants, [Range(0, 1000)] int Rank = 1);
public sealed record CategoryPolicy(Guid Id, [Required, StringLength(80)] string Name);
public sealed record ChannelPolicy(Guid Id, [Required, StringLength(80)] string Name, Guid? CategoryId);
public sealed record MemberRolePolicy(Guid UserId, Guid[] RoleIds);
public sealed record ResourceRule(Guid ResourceId, Guid RoleId, [Range(0, 16383)] int Allow, [Range(0, 16383)] int Deny);
public sealed record AccessPolicy(string Version, RolePolicy[] Roles, CategoryPolicy[] Categories, ChannelPolicy[] Channels,
    MemberRolePolicy[] Members, ResourceRule[] CategoryRules, ResourceRule[] ChannelRules, Guid? VoiceCategoryId = null, ResourceRule[]? VoiceRules = null);
public sealed record SaveAccessRequest(Guid ClientRequestId, [Required] AccessPolicy Policy);
public sealed record AccessSaved(string Version, string AppliedVersion);
public sealed record AuditDto(string Id, string ActorName, string Action, string TargetId, DateTimeOffset CreatedAt);
