using System.Security.Cryptography;
using System.Data;
using System.Text;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using App.Api.Features.Voice;

namespace App.Api.Features.Communities;

public sealed class CommunityService(AppDbContext database, IDataProtectionProvider protection)
{
    private readonly IDataProtector codes = protection.CreateProtector("Dosvyazi.CommunityInvites.v1");
    private static CommunityFailure Missing() => new(404, "Community or channel is unavailable.");
    private static CommunityFailure InvalidInvite() => new(404, "Invitation is unavailable. Ask the owner for a new code.");
    private static InviteSummary Summary(CommunityInvite invite) => new(invite.Id.ToString(), invite.MaxUses, invite.Uses, invite.ExpiresAt, invite.RevokedAt != null);

    public Task<CommunitySummary[]> ListAsync(Guid user, CancellationToken cancellationToken) => database.Communities.AsNoTracking()
        .Where(community => community.Members.Any(member => member.UserId == user && member.Status == "Active"))
        .OrderBy(community => community.CreatedAt).ThenBy(community => community.Id)
        .Select(community => new CommunitySummary(community.Id.ToString(), community.Name, community.OwnerId == user ? "Owner" : "Member"))
        .ToArrayAsync(cancellationToken);

    private async Task<ChannelSummary?> VisibleAsync(Guid id, TextChannel channel, Guid user, CancellationToken ct)
    {
        var access = await ChannelAccess.ResolveAsync(database, id, channel, user, ct);
        if (!access.View) return null;
        var category = channel.CategoryId is Guid categoryId ? await database.Categories.AsNoTracking().Where(c => c.Id == categoryId && c.CommunityId == id).Select(c => c.Name).SingleAsync(ct) : null;
        return new(channel.Id.ToString(), channel.Name, category, access.Send, access.SendDeniedBy, access.Has(ChannelAccess.ManageMessages));
    }

    public async Task<CommunityDetails> GetAsync(Guid id, Guid user, CancellationToken cancellationToken)
    {
        await using var tx = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        var community = await LockAsync(id, cancellationToken);
        if (!await database.Memberships.AnyAsync(m => m.CommunityId == id && m.UserId == user && m.Status == "Active", cancellationToken)) throw Missing();
        var channels = await database.TextChannels.AsNoTracking().Where(c => c.CommunityId == id).OrderBy(c => c.Name).ToArrayAsync(cancellationToken);
        var visible = new List<ChannelSummary>();
        foreach (var channel in channels) if (await VisibleAsync(id, channel, user, cancellationToken) is { } summary) visible.Add(summary);
        var count = await database.Memberships.CountAsync(m => m.CommunityId == id && m.Status == "Active", cancellationToken);
        var permissions = await ChannelAccess.BaseAsync(database, id, user, cancellationToken);
        var voice = await ChannelAccess.VoiceAsync(database, id, user, cancellationToken);
        var result = new CommunityDetails(id.ToString(), community.Name, community.OwnerId.ToString(), community.OwnerId == user ? "Owner" : "Member", count, visible.ToArray(), permissions.Permissions, permissions.Rank, voice.View);
        await tx.CommitAsync(cancellationToken);
        return result;
    }

    public async Task<ChannelSummary> ChannelAsync(Guid id, Guid channelId, Guid user, CancellationToken cancellationToken)
    {
        await using var tx = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        await LockAsync(id, cancellationToken);
        var channel = await database.TextChannels.AsNoTracking().SingleOrDefaultAsync(c => c.Id == channelId && c.CommunityId == id, cancellationToken) ?? throw Missing();
        var result = await VisibleAsync(id, channel, user, cancellationToken) ?? throw Missing();
        await tx.CommitAsync(cancellationToken);
        return result;
    }

    public async Task<CommunityDetails> CreateAsync(CreateCommunityRequest request, Guid user, CancellationToken cancellationToken)
    {
        var name = request.Name.Trim();
        if (request.ClientRequestId == Guid.Empty || name.Length is < 2 or > 80 || name.Any(char.IsControl))
            throw new CommunityFailure(400, "Use a request ID and a community name of 2–80 characters without control characters.");
        var existing = await database.Communities.AsNoTracking().SingleOrDefaultAsync(community => community.OwnerId == user && community.ClientRequestId == request.ClientRequestId, cancellationToken);
        if (existing is null)
        {
            await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
            var community = new Community { Id = Guid.NewGuid(), OwnerId = user, ClientRequestId = request.ClientRequestId, Name = name, CreatedAt = DateTimeOffset.UtcNow };
            database.Communities.Add(community);
            database.Memberships.Add(new Membership { Community = community, UserId = user, JoinedAt = community.CreatedAt });
            database.TextChannels.Add(new TextChannel { Id = Guid.NewGuid(), Community = community });
            database.CommunityRoles.Add(new CommunityRole { Id = community.Id, CommunityId = community.Id, Name = "everyone", Grants = ChannelAccess.DefaultGrants });
            try
            {
                await database.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                existing = community;
            }
            catch (DbUpdateException exception) when (exception.InnerException is Npgsql.PostgresException { SqlState: "23505", ConstraintName: "IX_Communities_OwnerId_ClientRequestId" })
            {
                await transaction.RollbackAsync(cancellationToken);
                database.ChangeTracker.Clear();
                existing = await database.Communities.AsNoTracking().SingleAsync(community => community.OwnerId == user && community.ClientRequestId == request.ClientRequestId, cancellationToken);
            }
        }
        if (existing.Name != name) throw new CommunityFailure(409, "This request ID was already used with a different community name.");
        return await GetAsync(existing.Id, user, cancellationToken);
    }

    // Every writer takes this lock first, including ban/leave/revocation. Read Committed
    // then reads the state committed by the previous writer, across multiple API hosts.
    private async Task<Community> LockAsync(Guid id, CancellationToken cancellationToken)
        => await database.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {id} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken) ?? throw Missing();

    private async Task ManagementAsync(Community community, Guid user, CancellationToken cancellationToken, int permission = ChannelAccess.ManageInvites)
    {
        if (!await database.Memberships.AnyAsync(member => member.CommunityId == community.Id && member.UserId == user && member.Status == "Active", cancellationToken)) throw Missing();
        var access = await ChannelAccess.BaseAsync(database, community.Id, user, cancellationToken);
        if ((access.Permissions & permission) == 0) throw new CommunityFailure(403, "The required management permission is not granted.");
    }

    public async Task<CreatedInvite> CreateInviteAsync(Guid id, CreateInviteRequest request, Guid user, CancellationToken cancellationToken)
    {
        if (request.ClientRequestId == Guid.Empty) throw new CommunityFailure(400, "A request ID is required.");
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        var community = await LockAsync(id, cancellationToken);
        await ManagementAsync(community, user, cancellationToken);
        var invite = await database.CommunityInvites.SingleOrDefaultAsync(item => item.CommunityId == id && item.ClientRequestId == request.ClientRequestId, cancellationToken);
        if (invite is null)
        {
            var code = RandomNumberGenerator.GetHexString(64).ToLowerInvariant();
            var now = DateTimeOffset.UtcNow;
            // PostgreSQL stores microseconds; match that precision before returning
            // the first DTO so an idempotent retry returns the same expiry.
            now = now.AddTicks(-(now.Ticks % 10));
            invite = new CommunityInvite { Id = Guid.NewGuid(), CommunityId = id, ClientRequestId = request.ClientRequestId,
                CodeHash = Hash(code), ProtectedCode = codes.Protect(code), LifetimeHours = request.LifetimeHours,
                MaxUses = request.MaxUses, CreatedAt = now, ExpiresAt = now.AddHours(request.LifetimeHours) };
            database.CommunityInvites.Add(invite);
            CommunityAudit.Add(database, id, user, "invite.created", invite.Id);
            await database.SaveChangesAsync(cancellationToken);
        }
        else if (invite.LifetimeHours != request.LifetimeHours || invite.MaxUses != request.MaxUses)
            throw new CommunityFailure(409, "This request ID was already used with different invitation limits.");
        var result = new CreatedInvite(Summary(invite), codes.Unprotect(invite.ProtectedCode));
        await transaction.CommitAsync(cancellationToken);
        return result;
    }

    public async Task<InviteSummary[]> InvitesAsync(Guid id, Guid user, CancellationToken cancellationToken)
    {
        await using var tx = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        var community = await LockAsync(id, cancellationToken);
        await ManagementAsync(community, user, cancellationToken);
        var result = await database.CommunityInvites.AsNoTracking().Where(item => item.CommunityId == id).OrderByDescending(item => item.CreatedAt)
            .Select(item => new InviteSummary(item.Id.ToString(), item.MaxUses, item.Uses, item.ExpiresAt, item.RevokedAt != null)).ToArrayAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return result;
    }

    public async Task<InviteSummary> RevokeInviteAsync(Guid id, Guid inviteId, Guid user, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        var community = await LockAsync(id, cancellationToken);
        await ManagementAsync(community, user, cancellationToken);
        var invite = await database.CommunityInvites.SingleOrDefaultAsync(item => item.CommunityId == id && item.Id == inviteId, cancellationToken) ?? throw Missing();
        if (invite.RevokedAt is null) { invite.RevokedAt = DateTimeOffset.UtcNow; CommunityAudit.Add(database, id, user, "invite.revoked", invite.Id); }
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Summary(invite);
    }

    private static string Hash(string code) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(code)));

    public async Task<CommunityDetails> AcceptAsync(string code, Guid user, CancellationToken cancellationToken)
    {
        var hash = Hash(code);
        var communityId = await database.CommunityInvites.AsNoTracking().Where(item => item.CodeHash == hash).Select(item => (Guid?)item.CommunityId).SingleOrDefaultAsync(cancellationToken) ?? throw InvalidInvite();
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        var community = await LockAsync(communityId, cancellationToken);
        var invite = await database.CommunityInvites.SingleAsync(item => item.CodeHash == hash, cancellationToken);
        var member = await database.Memberships.SingleOrDefaultAsync(item => item.CommunityId == communityId && item.UserId == user, cancellationToken);
        if (member?.Status == "Banned" || invite.RevokedAt != null || invite.ExpiresAt <= DateTimeOffset.UtcNow) throw InvalidInvite();
        if (member?.Status != "Active")
        {
            if (invite.Uses >= invite.MaxUses) throw InvalidInvite();
            if (member is null) database.Memberships.Add(new Membership { CommunityId = communityId, UserId = user, JoinedAt = DateTimeOffset.UtcNow });
            else { member.Status = "Active"; member.JoinedAt = DateTimeOffset.UtcNow; }
            invite.Uses++;
            community.PolicyVersion++;
            await database.SaveChangesAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return await GetAsync(communityId, user, cancellationToken);
    }

    public async Task<MemberSummary[]> MembersAsync(Guid id, Guid user, CancellationToken cancellationToken)
    {
        await using var tx = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        var community = await LockAsync(id, cancellationToken);
        await ManagementAsync(community, user, cancellationToken, ChannelAccess.ManageRoles | ChannelAccess.BanMembers | ChannelAccess.KickMembers);
        var result = await database.Memberships.AsNoTracking().Where(member => member.CommunityId == id).OrderBy(member => member.JoinedAt)
            .Select(member => new MemberSummary(member.UserId.ToString(), member.User.DisplayName, member.Status, member.UserId == community.OwnerId)).ToArrayAsync(cancellationToken);
        var assigned = await database.MemberRoles.AsNoTracking().Where(m => m.CommunityId == id).Join(database.CommunityRoles, m => m.RoleId, r => r.Id, (m, r) => new { m.UserId, r.Rank }).ToArrayAsync(cancellationToken);
        result = result.Select(m => m with { Rank = m.IsOwner ? int.MaxValue : assigned.Where(r => r.UserId == Guid.Parse(m.UserId)).Select(r => r.Rank).DefaultIfEmpty(0).Max() }).ToArray();
        await tx.CommitAsync(cancellationToken);
        return result;
    }

    public async Task<MemberSummary> BanAsync(Guid id, Guid target, bool banned, Guid user, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        var community = await LockAsync(id, cancellationToken);
        await ManagementAsync(community, user, cancellationToken, ChannelAccess.BanMembers);
        if (target == community.OwnerId) throw new CommunityFailure(409, "The owner cannot be banned.");
        await LowerRankAsync(id, user, target, cancellationToken);
        var member = await database.Memberships.Include(item => item.User).SingleOrDefaultAsync(item => item.CommunityId == id && item.UserId == target, cancellationToken) ?? throw Missing();
        var status = banned ? "Banned" : member.Status == "Banned" ? "Left" : member.Status;
        if (member.Status != status) { member.Status = status; community.PolicyVersion++; CommunityAudit.Add(database, id, user, banned ? "member.banned" : "member.ban-lifted", target); }
        if (banned)
        {
            await database.MemberRoles.Where(m => m.CommunityId == id && m.UserId == target).ExecuteDeleteAsync(cancellationToken);
            await VoiceTransitions.RevokeMemberAsync(database, id, target, cancellationToken);
        }
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new MemberSummary(target.ToString(), member.User.DisplayName, member.Status, false);
    }

    private async Task LowerRankAsync(Guid id, Guid actor, Guid target, CancellationToken ct)
    {
        var authority = await ChannelAccess.BaseAsync(database, id, actor, ct);
        var targetAccess = await ChannelAccess.BaseAsync(database, id, target, ct);
        if (target == actor || targetAccess.Rank >= authority.Rank) throw new CommunityFailure(403, "You cannot moderate yourself or an equal/higher-ranked member.");
    }

    public async Task<bool> KickAsync(Guid id, Guid target, Guid user, CancellationToken ct)
    {
        await using var tx = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var community = await LockAsync(id, ct);
        await ManagementAsync(community, user, ct, ChannelAccess.KickMembers);
        if (target == community.OwnerId) throw new CommunityFailure(409, "The owner cannot be removed.");
        await LowerRankAsync(id, user, target, ct);
        var member = await database.Memberships.SingleOrDefaultAsync(m => m.CommunityId == id && m.UserId == target, ct) ?? throw Missing();
        if (member.Status == "Banned") throw new CommunityFailure(409, "This member is banned.");
        if (member.Status == "Active")
        {
            member.Status = "Left"; community.PolicyVersion++;
            await database.MemberRoles.Where(m => m.CommunityId == id && m.UserId == target).ExecuteDeleteAsync(ct);
            await VoiceTransitions.RevokeMemberAsync(database, id, target, ct);
            CommunityAudit.Add(database, id, user, "member.removed", target);
            await database.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct);
        return true;
    }

    public async Task<AuditDto[]> AuditAsync(Guid id, Guid user, CancellationToken ct)
    {
        await using var tx = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var community = await LockAsync(id, ct);
        await ManagementAsync(community, user, ct, ChannelAccess.ManageRoles);
        var result = await database.AuditEntries.AsNoTracking().Where(a => a.CommunityId == id).OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.Id).Take(100)
            .Join(database.Users, a => a.ActorId, u => u.Id, (a, u) => new AuditDto(a.Id.ToString(), u.DisplayName, a.Action, a.TargetId.ToString(), a.CreatedAt)).ToArrayAsync(ct);
        await tx.CommitAsync(ct);
        return result;
    }

    public async Task<bool> LeaveAsync(Guid id, Guid user, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        var community = await LockAsync(id, cancellationToken);
        if (community.OwnerId == user) throw new CommunityFailure(409, "The owner cannot leave this community.");
        var member = await database.Memberships.SingleOrDefaultAsync(item => item.CommunityId == id && item.UserId == user, cancellationToken);
        if (member is null || member.Status == "Banned") throw Missing();
        if (member.Status != "Left") { member.Status = "Left"; community.PolicyVersion++; }
        await database.MemberRoles.Where(m => m.CommunityId == id && m.UserId == user).ExecuteDeleteAsync(cancellationToken);
        await VoiceTransitions.RevokeMemberAsync(database, id, user, cancellationToken);
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }
}
