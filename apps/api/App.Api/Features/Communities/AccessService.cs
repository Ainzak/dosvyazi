using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using App.Api.Features.Voice;

namespace App.Api.Features.Communities;

public sealed class AccessService(AppDbContext db)
{
    private async Task<Community> ManagerAsync(Guid id, Guid user, CancellationToken ct)
    {
        var community = await db.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {id} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (community is null || !await db.Memberships.AnyAsync(m => m.CommunityId == id && m.UserId == user && m.Status == "Active", ct))
            throw new CommunityFailure(404, "Community is unavailable.");
        var access = await ChannelAccess.BaseAsync(db, id, user, ct);
        if ((access.Permissions & (ChannelAccess.ManageRoles | ChannelAccess.ManageChannels)) != (ChannelAccess.ManageRoles | ChannelAccess.ManageChannels))
            throw new CommunityFailure(403, "ManageRoles and ManageChannels are required to manage access.");
        return community;
    }

    public async Task<AccessPolicy> GetAsync(Guid id, Guid user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var community = await ManagerAsync(id, user, ct);
        var roles = await db.CommunityRoles.AsNoTracking().Where(r => r.CommunityId == id).OrderBy(r => r.Id).Select(r => new RolePolicy(r.Id, r.Name, r.Grants, r.Rank)).ToArrayAsync(ct);
        var categories = await db.Categories.AsNoTracking().Where(c => c.CommunityId == id).OrderBy(c => c.Id).Select(c => new CategoryPolicy(c.Id, c.Name)).ToArrayAsync(ct);
        var channels = await db.TextChannels.AsNoTracking().Where(c => c.CommunityId == id).OrderBy(c => c.Id).Select(c => new ChannelPolicy(c.Id, c.Name, c.CategoryId)).ToArrayAsync(ct);
        var assignments = await db.MemberRoles.AsNoTracking().Where(m => m.CommunityId == id && db.Memberships.Any(member => member.CommunityId == id && member.UserId == m.UserId && member.Status == "Active")).ToArrayAsync(ct);
        var members = assignments.GroupBy(m => m.UserId).OrderBy(g => g.Key).Select(g => new MemberRolePolicy(g.Key, g.Select(m => m.RoleId).Order().ToArray())).ToArray();
        var categoryRules = await db.CategoryRoleRules.AsNoTracking().Where(r => r.CommunityId == id).OrderBy(r => r.CategoryId).ThenBy(r => r.RoleId).Select(r => new ResourceRule(r.CategoryId, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct);
        var channelRules = await db.ChannelRoleRules.AsNoTracking().Where(r => r.CommunityId == id).OrderBy(r => r.ChannelId).ThenBy(r => r.RoleId).Select(r => new ResourceRule(r.ChannelId, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct);
        var voiceRules = await db.VoiceRoleRules.AsNoTracking().Where(r => r.CommunityId == id).OrderBy(r => r.RoleId).Select(r => new ResourceRule(id, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct);
        var result = new AccessPolicy(community.PolicyVersion.ToString(CultureInfo.InvariantCulture), roles, categories, channels, members, categoryRules, channelRules, community.VoiceCategoryId, voiceRules);
        await tx.CommitAsync(ct);
        return result;
    }

    private static void Validate(Guid id, SaveAccessRequest request)
    {
        var p = request.Policy;
        if (request.ClientRequestId == Guid.Empty || p.Roles is null || p.Categories is null || p.Channels is null || p.Members is null || p.CategoryRules is null || p.ChannelRules is null ||
            p.Roles.Length is < 1 or > 20 || p.Categories.Length > 20 || p.Channels.Length is < 1 or > 50 || p.Members.Length > 500 || p.CategoryRules.Length > 400 || p.ChannelRules.Length > 1000)
            throw new CommunityFailure(400, "Use a bounded policy with a request ID, 1–20 roles, up to 20 categories and 1–50 channels.");
        if (p.Roles.Any(r => r is null) || p.Categories.Any(c => c is null) || p.Channels.Any(c => c is null) || p.Members.Any(m => m is null) || p.CategoryRules.Any(r => r is null) || p.ChannelRules.Any(r => r is null))
            throw new CommunityFailure(400, "Policy entries cannot be null.");
        static bool Name(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 80 && value == value.Trim() && !value.Any(char.IsControl);
        var roles = p.Roles.Select(r => r.Id).ToHashSet();
        var categories = p.Categories.Select(c => c.Id).ToHashSet();
        var channels = p.Channels.Select(c => c.Id).ToHashSet();
        if (!roles.Contains(id) || roles.Contains(Guid.Empty) || categories.Contains(Guid.Empty) || channels.Contains(Guid.Empty) ||
            roles.Count != p.Roles.Length || categories.Count != p.Categories.Length || channels.Count != p.Channels.Length ||
            p.Roles.Select(r => r.Name).Distinct().Count() != p.Roles.Length || p.Categories.Select(c => c.Name).Distinct().Count() != p.Categories.Length ||
            p.Roles.Any(r => !Name(r.Name) || !ChannelAccess.Valid(r.Grants) || r.Rank is < 0 or > 1000 || (r.Id != id && r.Rank == 0) || (r.Id == id && r.Name != "everyone")) ||
            p.Categories.Any(c => !Name(c.Name)) || p.Channels.Any(c => !Name(c.Name) || (c.CategoryId is Guid category && !categories.Contains(category))) ||
            p.Channels.Select(c => c.Name).Distinct().Count() != p.Channels.Length ||
            p.Members.Select(m => m.UserId).Distinct().Count() != p.Members.Length || p.Members.Any(m => m.RoleIds is null || m.RoleIds.Length > 19 || m.RoleIds.Distinct().Count() != m.RoleIds.Length || m.RoleIds.Any(r => r == id || !roles.Contains(r))))
            throw new CommunityFailure(400, "Invalid names, duplicate IDs or references in this policy. The everyone role is implicit for every member.");
        static bool Rules(ResourceRule[] rules, HashSet<Guid> resources, HashSet<Guid> roles) => !rules.Any(r => r is null) && rules.Select(r => (r.ResourceId, r.RoleId)).Distinct().Count() == rules.Length &&
            rules.All(r => resources.Contains(r.ResourceId) && roles.Contains(r.RoleId) && ChannelAccess.Valid(r.Allow) && ChannelAccess.Valid(r.Deny));
        if (!Rules(p.CategoryRules, categories, roles) || !Rules(p.ChannelRules, channels, roles) || (p.VoiceCategoryId is Guid voiceCategory && !categories.Contains(voiceCategory)) ||
            (p.VoiceRules is not null && (p.VoiceRules.Length > 20 || !Rules(p.VoiceRules, [id], roles)))) throw new CommunityFailure(400, "Invalid or duplicate resource rules.");
        const int textBits = ChannelAccess.All | ChannelAccess.ManageMessages | ChannelAccess.ManageChannels;
        const int voiceBits = ChannelAccess.View | ChannelAccess.ManageChannels | ChannelAccess.ConnectVoice | ChannelAccess.SpeakVoice | ChannelAccess.ModerateVoice;
        if (p.ChannelRules.Any(r => ((r.Allow | r.Deny) & ~textBits) != 0) || p.CategoryRules.Any(r => ((r.Allow | r.Deny) & ~(textBits | voiceBits)) != 0) || (p.VoiceRules ?? []).Any(r => ((r.Allow | r.Deny) & ~voiceBits) != 0))
            throw new CommunityFailure(400, "Use resource permissions in rules; member, invitation and role management permissions are community grants.");
    }

    public async Task<AccessSaved> SaveAsync(Guid id, Guid user, SaveAccessRequest request, CancellationToken ct)
    {
        Validate(id, request);
        var p = request.Policy;
        var hash = Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(p)));
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var community = await ManagerAsync(id, user, ct);
        var prior = await db.AccessChanges.SingleOrDefaultAsync(c => c.CommunityId == id && c.ClientRequestId == request.ClientRequestId, ct);
        if (prior is not null)
        {
            if (prior.ActorId != user || prior.Hash != hash) throw new CommunityFailure(409, "This request ID was already used with a different policy.");
            await tx.CommitAsync(ct);
            return new(community.PolicyVersion.ToString(CultureInfo.InvariantCulture), prior.ResultVersion.ToString(CultureInfo.InvariantCulture));
        }
        if (p.Version != community.PolicyVersion.ToString(CultureInfo.InvariantCulture)) throw new CommunityFailure(409, "Access changed. Reload before saving your changes.");
        var roles = await db.CommunityRoles.Where(r => r.CommunityId == id).ToDictionaryAsync(r => r.Id, ct);
        var categories = await db.Categories.Where(c => c.CommunityId == id).ToDictionaryAsync(c => c.Id, ct);
        var channels = await db.TextChannels.Where(c => c.CommunityId == id).ToDictionaryAsync(c => c.Id, ct);
        await CheckDelegationAsync(community, user, p, roles, categories, channels, ct);
        if (roles.Keys.Except(p.Roles.Select(r => r.Id)).Any() || categories.Keys.Except(p.Categories.Select(c => c.Id)).Any() || channels.Keys.Except(p.Channels.Select(c => c.Id)).Any())
            throw new CommunityFailure(400, "Existing resources must be retained. Resource deletion is not available.");
        var memberIds = p.Members.Select(m => m.UserId).ToArray();
        if (await db.Memberships.CountAsync(m => m.CommunityId == id && memberIds.Contains(m.UserId) && m.Status == "Active", ct) != memberIds.Length)
            throw new CommunityFailure(400, "Assign roles only to active members of this community.");
        // Existing IDs in another community cannot be imported, even without a rule referencing them.
        var roleIds = p.Roles.Select(r => r.Id).ToArray(); var categoryIds = p.Categories.Select(c => c.Id).ToArray(); var channelIds = p.Channels.Select(c => c.Id).ToArray();
        if (await db.CommunityRoles.AnyAsync(r => r.CommunityId != id && roleIds.Contains(r.Id), ct) || await db.Categories.AnyAsync(c => c.CommunityId != id && categoryIds.Contains(c.Id), ct) || await db.TextChannels.AnyAsync(c => c.CommunityId != id && channelIds.Contains(c.Id), ct))
            throw new CommunityFailure(400, "Resource IDs must belong to this community.");
        foreach (var r in p.Roles)
        {
            if (!roles.TryGetValue(r.Id, out var entity)) { entity = new CommunityRole { Id = r.Id, CommunityId = id }; db.CommunityRoles.Add(entity); }
            entity.Name = r.Name; entity.Grants = r.Grants; entity.Rank = r.Id == id ? 0 : r.Rank;
        }
        foreach (var c in p.Categories)
        {
            if (!categories.TryGetValue(c.Id, out var entity)) { entity = new Category { Id = c.Id, CommunityId = id }; db.Categories.Add(entity); }
            entity.Name = c.Name;
        }
        // Avoid a unique-name swap violating the existing channel index mid-update.
        if (p.Channels.Any(c => channels.TryGetValue(c.Id, out var current) && current.Name != c.Name))
            throw new CommunityFailure(400, "Existing channel names cannot be changed in this slice.");
        foreach (var c in p.Channels)
        {
            if (!channels.TryGetValue(c.Id, out var entity)) { entity = new TextChannel { Id = c.Id, CommunityId = id, Name = c.Name }; db.TextChannels.Add(entity); }
            entity.CategoryId = c.CategoryId;
        }
        await db.SaveChangesAsync(ct);
        await db.MemberRoles.Where(m => m.CommunityId == id).ExecuteDeleteAsync(ct);
        await db.CategoryRoleRules.Where(r => r.CommunityId == id).ExecuteDeleteAsync(ct);
        await db.ChannelRoleRules.Where(r => r.CommunityId == id).ExecuteDeleteAsync(ct);
        await db.VoiceRoleRules.Where(r => r.CommunityId == id).ExecuteDeleteAsync(ct);
        db.MemberRoles.AddRange(p.Members.SelectMany(m => m.RoleIds.Select(r => new MemberRole { CommunityId = id, UserId = m.UserId, RoleId = r })));
        db.CategoryRoleRules.AddRange(p.CategoryRules.Select(r => new CategoryRoleRule { CommunityId = id, CategoryId = r.ResourceId, RoleId = r.RoleId, Allow = r.Allow, Deny = r.Deny }));
        db.ChannelRoleRules.AddRange(p.ChannelRules.Select(r => new ChannelRoleRule { CommunityId = id, ChannelId = r.ResourceId, RoleId = r.RoleId, Allow = r.Allow, Deny = r.Deny }));
        db.VoiceRoleRules.AddRange((p.VoiceRules ?? []).Select(r => new VoiceRoleRule { CommunityId = id, RoleId = r.RoleId, Allow = r.Allow, Deny = r.Deny }));
        community.VoiceCategoryId = p.VoiceCategoryId;
        community.PolicyVersion = checked(community.PolicyVersion + 1);
        db.AccessChanges.Add(new AccessChange { CommunityId = id, ClientRequestId = request.ClientRequestId, ActorId = user, Hash = hash, ResultVersion = community.PolicyVersion, CreatedAt = DateTimeOffset.UtcNow });
        CommunityAudit.Add(db, id, user, "access.updated", id);
        await db.SaveChangesAsync(ct);
        foreach (var lease in await db.VoiceLeases.Where(l => l.CommunityId == id && l.Active).ToArrayAsync(ct))
        {
            var access = await ChannelAccess.VoiceAsync(db, id, lease.UserId, ct);
            if (!access.Connect || access.Speak != lease.CanSpeak) await VoiceTransitions.RevokeMemberAsync(db, id, lease.UserId, ct);
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        var version = community.PolicyVersion.ToString(CultureInfo.InvariantCulture);
        return new(version, version);
    }

    private async Task CheckDelegationAsync(Community community, Guid user, AccessPolicy policy, Dictionary<Guid, CommunityRole> roles, Dictionary<Guid, Category> categories, Dictionary<Guid, TextChannel> channels, CancellationToken ct)
    {
        if (community.OwnerId == user) return;
        var actor = await ChannelAccess.BaseAsync(db, community.Id, user, ct);
        var forbidden = new CommunityFailure(403, "Managers cannot exceed their permissions or change equal/higher-ranked roles or members.");
        foreach (var role in policy.Roles)
        {
            var changed = !roles.TryGetValue(role.Id, out var prior) || prior.Name != role.Name || prior.Grants != role.Grants || (role.Id != community.Id && prior.Rank != role.Rank);
            if (changed && ((prior is not null && prior.Rank >= actor.Rank) || (role.Id != community.Id && role.Rank >= actor.Rank) || (role.Grants & ~actor.Permissions) != 0)) throw forbidden;
        }
        var existing = await db.MemberRoles.AsNoTracking().Where(m => m.CommunityId == community.Id).ToArrayAsync(ct);
        foreach (var target in existing.Select(m => m.UserId).Concat(policy.Members.Select(m => m.UserId)).Distinct())
        {
            var before = existing.Where(m => m.UserId == target).Select(m => m.RoleId).ToHashSet();
            var after = policy.Members.SingleOrDefault(m => m.UserId == target)?.RoleIds.ToHashSet() ?? [];
            if (before.SetEquals(after)) continue;
            var targetAccess = await ChannelAccess.BaseAsync(db, community.Id, target, ct);
            if (target == community.OwnerId || targetAccess.Rank >= actor.Rank || before.Concat(after).Any(r => roles.TryGetValue(r, out var role) && role.Rank >= actor.Rank) ||
                after.Any(r => { var role = policy.Roles.Single(role => role.Id == r); return role.Rank >= actor.Rank || (role.Grants & ~actor.Permissions) != 0; })) throw forbidden;
        }
        var beforeCategory = await db.CategoryRoleRules.AsNoTracking().Where(r => r.CommunityId == community.Id).Select(r => new ResourceRule(r.CategoryId, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct);
        var beforeChannel = await db.ChannelRoleRules.AsNoTracking().Where(r => r.CommunityId == community.Id).Select(r => new ResourceRule(r.ChannelId, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct);
        var beforeVoice = await db.VoiceRoleRules.AsNoTracking().Where(r => r.CommunityId == community.Id).Select(r => new ResourceRule(community.Id, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct);
        static IEnumerable<ResourceRule> Changed(ResourceRule[] before, ResourceRule[] after) => before.Except(after).Concat(after.Except(before));
        foreach (var rule in Changed(beforeCategory, policy.CategoryRules).Concat(Changed(beforeChannel, policy.ChannelRules)).Concat(Changed(beforeVoice, policy.VoiceRules ?? [])))
            if ((roles.TryGetValue(rule.RoleId, out var role) && role.Rank >= actor.Rank) || (rule.Allow & ~actor.Permissions) != 0) throw forbidden;
        var changedCategories = policy.Categories.Where(c => !categories.TryGetValue(c.Id, out var prior) || prior.Name != c.Name).Select(c => c.Id)
            .Concat(Changed(beforeCategory, policy.CategoryRules).Select(r => r.ResourceId)).ToHashSet();
        foreach (var channel in channels.Values)
            if (policy.Channels.Any(c => c.Id == channel.Id && (c.CategoryId != channel.CategoryId || c.Name != channel.Name)) ||
                Changed(beforeChannel, policy.ChannelRules).Any(r => r.ResourceId == channel.Id) || (channel.CategoryId is Guid category && changedCategories.Contains(category)))
                if (!(await ChannelAccess.ResolveAsync(db, community.Id, channel, user, ct)).Has(ChannelAccess.ManageChannels)) throw new CommunityFailure(403, "ManageChannels is denied for an affected channel.");
        if (community.VoiceCategoryId != policy.VoiceCategoryId || Changed(beforeVoice, policy.VoiceRules ?? []).Any() || (community.VoiceCategoryId is Guid voiceCategory && changedCategories.Contains(voiceCategory)))
            if (!(await ChannelAccess.VoiceAsync(db, community.Id, user, ct)).Has(ChannelAccess.ManageChannels)) throw new CommunityFailure(403, "ManageChannels is denied for voice.");
    }
}
