using App.Api.Infrastructure.Persistence;

namespace App.Api.Features.Communities;

public static class CommunityAudit
{
    // Called in the same transaction as the action; omit personal message bodies and secrets.
    public static void Add(AppDbContext db, Guid community, Guid actor, string action, Guid target) => db.AuditEntries.Add(new AuditEntry
    { Id = Guid.NewGuid(), CommunityId = community, ActorId = actor, Action = action, TargetId = target, CreatedAt = DateTimeOffset.UtcNow });
}
