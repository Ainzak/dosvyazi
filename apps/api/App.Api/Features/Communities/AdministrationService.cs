using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Communities;

public sealed record RightSource(string Scope, string Role, int Allow, int Deny);
public sealed record RightDecision(string Permission, bool Allowed, int Required);
public sealed record RightsExplanation(string Version, bool OwnerOverride, RightSource[] Sources, RightDecision[] Decisions);
public sealed record CommunityConfiguration(string Format, int Version, string Name, Guid EveryoneRoleId,
    RolePolicy[] Roles, CategoryPolicy[] Categories, ChannelPolicy[] Channels, ResourceRule[] CategoryRules,
    ResourceRule[] ChannelRules, Guid? VoiceCategoryId, ResourceRule[] VoiceRules);
public sealed record ConfigurationPreviewRequest(JsonElement Configuration);
public sealed record ConfigurationRestoreRequest(Guid ClientRequestId, string Name, JsonElement Configuration);
public sealed record ConfigurationRestored(string CommunityId);

public sealed class AdministrationService(AppDbContext db)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow, PropertyNameCaseInsensitive = false, MaxDepth = 16 };
    private static CommunityFailure Missing() => new(404, "Community or resource is unavailable.");
    private async Task<Community> Lock(Guid id, Guid actor, CancellationToken ct)
    {
        var c = await db.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {id} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (c is null || !await db.Memberships.AnyAsync(m => m.CommunityId == id && m.UserId == actor && m.Status == "Active", ct)) throw Missing();
        return c;
    }

    public async Task<RightsExplanation> Explain(Guid id, Guid actor, string kind, Guid? channelId, Guid? userId, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var c = await Lock(id, actor, ct);
        var target = userId ?? actor;
        if (target != actor)
        {
            var authority = await ChannelAccess.BaseAsync(db, id, actor, ct);
            if ((authority.Permissions & 96) != 96) throw new CommunityFailure(403, "ManageRoles and ManageChannels are required to inspect another member.");
            if (!await db.Memberships.AnyAsync(m => m.CommunityId == id && m.UserId == target && m.Status == "Active", ct)) throw Missing();
        }
        if (kind is not ("text" or "voice")) throw new CommunityFailure(400, "Choose a text or voice resource.");
        var voice = kind == "voice";
        TextChannel? channel = voice ? null : await db.TextChannels.AsNoTracking().SingleOrDefaultAsync(ch => ch.Id == channelId && ch.CommunityId == id, ct) ?? throw Missing();
        var archivedDiscussion = channel?.DiscussionArchived == true && channel.ParentChannelId != null;
        var archiveLabel = channel?.Kind == "ForumTopic" ? "Archived forum topic" : "Archived thread";
        if (channel?.ParentChannelId is Guid parentId)
            channel = await db.TextChannels.AsNoTracking().SingleOrDefaultAsync(ch => ch.Id == parentId && ch.CommunityId == id && ch.ParentChannelId == null, ct) ?? throw Missing();
        var actorAccess = voice ? await ChannelAccess.VoiceAsync(db, id, actor, ct) : await ChannelAccess.ResolveAsync(db, id, channel!, actor, ct);
        if (!actorAccess.View) throw Missing();
        var access = voice ? await ChannelAccess.VoiceAsync(db, id, target, ct) : await ChannelAccess.ResolveAsync(db, id, channel!, target, ct);
        if (archivedDiscussion) access = access with { Permissions = access.Permissions & ~ChannelAccess.Send };
        var assigned = await db.MemberRoles.AsNoTracking().Where(r => r.CommunityId == id && r.UserId == target).Select(r => r.RoleId).ToArrayAsync(ct);
        var roles = await db.CommunityRoles.AsNoTracking().Where(r => r.CommunityId == id && (r.Id == id || assigned.Contains(r.Id))).OrderBy(r => r.Rank).ThenBy(r => r.Name).ToArrayAsync(ct);
        var roleIds = roles.Select(r => r.Id).ToArray();
        var categoryId = voice ? c.VoiceCategoryId : channel!.CategoryId;
        var category = await db.CategoryRoleRules.AsNoTracking().Where(r => r.CommunityId == id && r.CategoryId == categoryId && roleIds.Contains(r.RoleId)).Select(r => new ResourceRule(r.CategoryId, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct);
        var resource = voice ? await db.VoiceRoleRules.AsNoTracking().Where(r => r.CommunityId == id && roleIds.Contains(r.RoleId)).Select(r => new ResourceRule(id, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct)
            : await db.ChannelRoleRules.AsNoTracking().Where(r => r.CommunityId == id && r.ChannelId == channel!.Id && roleIds.Contains(r.RoleId)).Select(r => new ResourceRule(r.ChannelId, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct);
        var sources = roles.Select(r => new RightSource("role", r.Name, r.Grants, 0))
            .Concat(category.OrderBy(r => r.RoleId).Select(r => new RightSource("category", roles.Single(role => role.Id == r.RoleId).Name, r.Allow, r.Deny)))
            .Concat(resource.OrderBy(r => r.RoleId).Select(r => new RightSource(kind, roles.Single(role => role.Id == r.RoleId).Name, r.Allow, r.Deny))).ToArray();
        if (archivedDiscussion) sources = [.. sources, new("discussion", archiveLabel, 0, ChannelAccess.Send)];
        (string Name, int Required)[] definitions = voice
            ? [("ViewChannel", 1), ("ConnectVoice", 1 | 2048), ("SpeakVoice", 1 | 2048 | 4096), ("ShareScreen", 1 | 2048 | 4096 | 16384), ("UseCamera", 1 | 2048 | 4096 | 32768), ("ModerateVoice", 1 | 8192)]
            : [("ViewChannel", 1), ("SendMessage", 1 | 2), ("ManageMessages", 1 | 4)];
        var result = new RightsExplanation(c.PolicyVersion.ToString(CultureInfo.InvariantCulture), target == c.OwnerId, sources,
            definitions.Select(d => new RightDecision(d.Name, access.Has(d.Required), d.Required)).ToArray());
        await tx.CommitAsync(ct);
        return result;
    }

    public async Task<CommunityConfiguration> Export(Guid id, Guid actor, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var c = await Lock(id, actor, ct);
        // A manager need not have access to every private resource; only the owner may export the full map.
        if (c.OwnerId != actor) throw new CommunityFailure(403, "Only the community owner can export its configuration.");
        var result = new CommunityConfiguration("dosvyazi-community", 1, c.Name, id,
            await db.CommunityRoles.AsNoTracking().Where(r => r.CommunityId == id).OrderBy(r => r.Id).Select(r => new RolePolicy(r.Id, r.Name, r.Grants, r.Rank)).ToArrayAsync(ct),
            await db.Categories.AsNoTracking().Where(r => r.CommunityId == id).OrderBy(r => r.Id).Select(r => new CategoryPolicy(r.Id, r.Name)).ToArrayAsync(ct),
            await db.TextChannels.AsNoTracking().Where(r => r.CommunityId == id && r.ParentChannelId == null).OrderBy(r => r.Id).Select(r => new ChannelPolicy(r.Id, r.Name, r.CategoryId, r.Kind)).ToArrayAsync(ct),
            await db.CategoryRoleRules.AsNoTracking().Where(r => r.CommunityId == id).OrderBy(r => r.CategoryId).ThenBy(r => r.RoleId).Select(r => new ResourceRule(r.CategoryId, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct),
            await db.ChannelRoleRules.AsNoTracking().Where(r => r.CommunityId == id).OrderBy(r => r.ChannelId).ThenBy(r => r.RoleId).Select(r => new ResourceRule(r.ChannelId, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct), c.VoiceCategoryId,
            await db.VoiceRoleRules.AsNoTracking().Where(r => r.CommunityId == id).OrderBy(r => r.RoleId).Select(r => new ResourceRule(id, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct));
        await tx.CommitAsync(ct);
        return result;
    }

    public static CommunityConfiguration Validate(JsonElement raw)
    {
        CommunityConfiguration document;
        try { document = raw.Deserialize<CommunityConfiguration>(Json) ?? throw new JsonException(); }
        catch (Exception e) when (e is JsonException or InvalidOperationException) { throw new CommunityFailure(400, "Invalid configuration file. Use an unmodified version 1 export."); }
        if (document.Format != "dosvyazi-community" || document.Version != 1 || document.EveryoneRoleId == Guid.Empty || document.VoiceRules is null ||
            string.IsNullOrWhiteSpace(document.Name) || document.Name != document.Name.Trim() || document.Name.Length is < 2 or > 80 || document.Name.Any(char.IsControl))
            throw new CommunityFailure(400, "Unsupported configuration format, version or name.");
        AccessService.Validate(document.EveryoneRoleId, new SaveAccessRequest(Guid.NewGuid(), Policy(document)));
        return document;
    }
    private static AccessPolicy Policy(CommunityConfiguration d) => new("1", d.Roles, d.Categories, d.Channels, [], d.CategoryRules, d.ChannelRules, d.VoiceCategoryId, d.VoiceRules);

    public async Task<ConfigurationRestored> Restore(Guid actor, ConfigurationRestoreRequest request, CancellationToken ct)
    {
        var d = Validate(request.Configuration);
        var name = request.Name?.Trim() ?? "";
        if (request.ClientRequestId == Guid.Empty || name.Length is < 2 or > 80 || name.Any(char.IsControl)) throw new CommunityFailure(400, "Use a request ID and a community name of 2–80 characters.");
        var hash = Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { Operation = "configuration-v1", Name = name, Document = d }, Json)));
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        // Serialize restores by this actor; the existing unique owner/request index also protects against ordinary creation.
        _ = await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {actor} FOR UPDATE").SingleAsync(ct);
        var prior = await db.Communities.SingleOrDefaultAsync(c => c.OwnerId == actor && c.ClientRequestId == request.ClientRequestId, ct);
        if (prior is not null)
        {
            var receipt = await db.AccessChanges.AsNoTracking().SingleOrDefaultAsync(r => r.CommunityId == prior.Id && r.ClientRequestId == request.ClientRequestId, ct);
            if (receipt?.Hash != hash || receipt.ActorId != actor) throw new CommunityFailure(409, "This request ID was already used with another configuration.");
            await tx.CommitAsync(ct);
            return new(prior.Id.ToString());
        }
        var id = Guid.NewGuid();
        var roleMap = d.Roles.ToDictionary(r => r.Id, r => r.Id == d.EveryoneRoleId ? id : Guid.NewGuid());
        var categoryMap = d.Categories.ToDictionary(r => r.Id, _ => Guid.NewGuid());
        var channelMap = d.Channels.ToDictionary(r => r.Id, _ => Guid.NewGuid());
        var now = DateTimeOffset.UtcNow;
        var community = new Community { Id = id, OwnerId = actor, ClientRequestId = request.ClientRequestId, Name = name, CreatedAt = now, VoiceCategoryId = null };
        db.Communities.Add(community);
        db.Memberships.Add(new Membership { Community = community, UserId = actor, JoinedAt = now });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException e) when (e.InnerException is Npgsql.PostgresException { SqlState: "23505", ConstraintName: "IX_Communities_OwnerId_ClientRequestId" })
        { throw new CommunityFailure(409, "This request ID was already used by another community command."); }
        db.CommunityRoles.AddRange(d.Roles.Select(r => new CommunityRole { CommunityId = id, Id = roleMap[r.Id], Name = r.Name, Grants = r.Grants, Rank = r.Id == d.EveryoneRoleId ? 0 : r.Rank }));
        db.Categories.AddRange(d.Categories.Select(r => new Category { CommunityId = id, Id = categoryMap[r.Id], Name = r.Name }));
        await db.SaveChangesAsync(ct);
        db.TextChannels.AddRange(d.Channels.Select(r => new TextChannel { CommunityId = id, Id = channelMap[r.Id], Name = r.Name, Kind = r.Kind, CategoryId = r.CategoryId is Guid cat ? categoryMap[cat] : null }));
        await db.SaveChangesAsync(ct);
        db.CategoryRoleRules.AddRange(d.CategoryRules.Select(r => new CategoryRoleRule { CommunityId = id, CategoryId = categoryMap[r.ResourceId], RoleId = roleMap[r.RoleId], Allow = r.Allow, Deny = r.Deny }));
        db.ChannelRoleRules.AddRange(d.ChannelRules.Select(r => new ChannelRoleRule { CommunityId = id, ChannelId = channelMap[r.ResourceId], RoleId = roleMap[r.RoleId], Allow = r.Allow, Deny = r.Deny }));
        db.VoiceRoleRules.AddRange(d.VoiceRules.Select(r => new VoiceRoleRule { CommunityId = id, RoleId = roleMap[r.RoleId], Allow = r.Allow, Deny = r.Deny }));
        community.VoiceCategoryId = d.VoiceCategoryId is Guid vc ? categoryMap[vc] : null;
        db.AccessChanges.Add(new AccessChange { CommunityId = id, ClientRequestId = request.ClientRequestId, ActorId = actor, Hash = hash, ResultVersion = 1, CreatedAt = now });
        CommunityAudit.Add(db, id, actor, "configuration.restored", id);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(id.ToString());
    }
}
