using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Communities;

public sealed record EffectiveChannelAccess(int Permissions, string? SendDeniedBy, string? VoiceDeniedBy)
{
    public bool View => Has(ChannelAccess.View);
    public bool Send => Has(ChannelAccess.View | ChannelAccess.Send);
    public bool Connect => Has(ChannelAccess.View | ChannelAccess.ConnectVoice);
    public bool Speak => Connect && Has(ChannelAccess.SpeakVoice);
    public bool Has(int bits) => (Permissions & bits) == bits;
}

public static class ChannelAccess
{
    public const int View = 1, Send = 2, ManageMessages = 4, ManageChannels = 32, ManageRoles = 64,
        ManageInvites = 128, KickMembers = 512, BanMembers = 1024, ConnectVoice = 2048, SpeakVoice = 4096, ModerateVoice = 8192;
    public const int All = View | Send;
    // Reactions/files/emojis remain M5; unsupported bits cannot be granted yet.
    public const int Supported = All | ManageMessages | ManageChannels | ManageRoles | ManageInvites | KickMembers | BanMembers | ConnectVoice | SpeakVoice | ModerateVoice;
    public const int DefaultGrants = All | ConnectVoice | SpeakVoice;
    public static bool Valid(int bits) => bits >= 0 && (bits & ~Supported) == 0;

    public static async Task<(int Permissions, int Rank)> BaseAsync(AppDbContext db, Guid community, Guid user, CancellationToken ct)
    {
        if (!await db.Memberships.AsNoTracking().AnyAsync(m => m.CommunityId == community && m.UserId == user && m.Status == "Active", ct)) return (0, 0);
        if (await db.Communities.AsNoTracking().AnyAsync(c => c.Id == community && c.OwnerId == user, ct)) return (Supported, int.MaxValue);
        var assigned = await db.MemberRoles.AsNoTracking().Where(m => m.CommunityId == community && m.UserId == user).Select(m => m.RoleId).ToArrayAsync(ct);
        var roles = await db.CommunityRoles.AsNoTracking().Where(r => r.CommunityId == community && (r.Id == community || assigned.Contains(r.Id))).ToArrayAsync(ct);
        return (roles.Aggregate(0, (value, role) => value | role.Grants), roles.Select(r => r.Rank).DefaultIfEmpty(0).Max());
    }

    public static Task<EffectiveChannelAccess> ResolveAsync(AppDbContext db, Guid community, TextChannel channel, Guid user, CancellationToken ct) =>
        channel.CommunityId != community ? Task.FromResult(new EffectiveChannelAccess(0, null, null)) : ResolveCoreAsync(db, community, channel.Id, channel.CategoryId, user, false, ct);

    public static async Task<EffectiveChannelAccess> VoiceAsync(AppDbContext db, Guid community, Guid user, CancellationToken ct)
    {
        var category = await db.Communities.AsNoTracking().Where(c => c.Id == community).Select(c => c.VoiceCategoryId).SingleOrDefaultAsync(ct);
        return await ResolveCoreAsync(db, community, community, category, user, true, ct);
    }

    // Call under the community lock when used to authorize an operation/publication.
    private static async Task<EffectiveChannelAccess> ResolveCoreAsync(AppDbContext db, Guid community, Guid resource, Guid? categoryId, Guid user, bool voice, CancellationToken ct)
    {
        var baseline = await BaseAsync(db, community, user, ct);
        if (baseline.Rank == int.MaxValue) return new(Supported, null, null);
        if (!await db.Memberships.AsNoTracking().AnyAsync(m => m.CommunityId == community && m.UserId == user && m.Status == "Active", ct)) return new(0, null, null);
        var assigned = await db.MemberRoles.AsNoTracking().Where(m => m.CommunityId == community && m.UserId == user).Select(m => m.RoleId).ToArrayAsync(ct);
        var roles = await db.CommunityRoles.AsNoTracking().Where(r => r.CommunityId == community && (r.Id == community || assigned.Contains(r.Id))).ToArrayAsync(ct);
        var category = await db.CategoryRoleRules.AsNoTracking().Where(r => r.CommunityId == community && r.CategoryId == categoryId && (r.RoleId == community || assigned.Contains(r.RoleId)))
            .Select(r => new ResourceRule(r.CategoryId, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct);
        var rules = voice ? await db.VoiceRoleRules.AsNoTracking().Where(r => r.CommunityId == community && (r.RoleId == community || assigned.Contains(r.RoleId)))
            .Select(r => new ResourceRule(community, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct)
            : await db.ChannelRoleRules.AsNoTracking().Where(r => r.CommunityId == community && r.ChannelId == resource && (r.RoleId == community || assigned.Contains(r.RoleId)))
                .Select(r => new ResourceRule(r.ChannelId, r.RoleId, r.Allow, r.Deny)).ToArrayAsync(ct);
        var allow = category.Concat(rules).Aggregate(baseline.Permissions, (value, r) => value | r.Allow);
        var deny = category.Concat(rules).Aggregate(0, (value, r) => value | r.Deny);
        string? Reason(int bits, string name)
        {
            if (((allow & ~deny) & bits) == bits) return null;
            var sources = category.Where(r => (r.Deny & bits) != 0).Select(r => $"category rule for {roles.Single(role => role.Id == r.RoleId).Name}")
                .Concat(rules.Where(r => (r.Deny & bits) != 0).Select(r => $"{(voice ? "voice" : "channel")} rule for {roles.Single(role => role.Id == r.RoleId).Name}")).ToArray();
            return sources.Length > 0 ? string.Join(", ", sources) : $"no role grants {name}";
        }
        return new(allow & ~deny, Reason(Send, "SendMessage"), Reason(View | ConnectVoice | SpeakVoice, "voice permissions"));
    }
}
