using System.Security.Cryptography;
using System.Data;
using System.Text;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

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

    public async Task<CommunityDetails> GetAsync(Guid id, Guid user, CancellationToken cancellationToken)
        => await database.Communities.AsNoTracking()
            .Where(community => community.Id == id && community.Members.Any(member => member.UserId == user && member.Status == "Active"))
            .Select(community => new CommunityDetails(community.Id.ToString(), community.Name, community.OwnerId.ToString(),
                community.OwnerId == user ? "Owner" : "Member", community.Members.Count(member => member.Status == "Active"),
                community.Channels.OrderBy(channel => channel.Name).Select(channel => new ChannelSummary(channel.Id.ToString(), channel.Name)).ToArray()))
            .SingleOrDefaultAsync(cancellationToken) ?? throw Missing();

    public async Task<ChannelSummary> ChannelAsync(Guid id, Guid channelId, Guid user, CancellationToken cancellationToken)
        => await database.TextChannels.AsNoTracking()
            .Where(channel => channel.Id == channelId && channel.CommunityId == id &&
                channel.Community.Members.Any(member => member.UserId == user && member.Status == "Active"))
            .Select(channel => new ChannelSummary(channel.Id.ToString(), channel.Name)).SingleOrDefaultAsync(cancellationToken) ?? throw Missing();

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

    private async Task OwnerAsync(Community community, Guid user, CancellationToken cancellationToken)
    {
        if (!await database.Memberships.AnyAsync(member => member.CommunityId == community.Id && member.UserId == user && member.Status == "Active", cancellationToken)) throw Missing();
        if (community.OwnerId != user) throw new CommunityFailure(403, "Only the community owner can manage invitations and members.");
    }

    public async Task<CreatedInvite> CreateInviteAsync(Guid id, CreateInviteRequest request, Guid user, CancellationToken cancellationToken)
    {
        if (request.ClientRequestId == Guid.Empty) throw new CommunityFailure(400, "A request ID is required.");
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        var community = await LockAsync(id, cancellationToken);
        await OwnerAsync(community, user, cancellationToken);
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
        var community = await database.Communities.AsNoTracking().SingleOrDefaultAsync(item => item.Id == id, cancellationToken) ?? throw Missing();
        await OwnerAsync(community, user, cancellationToken);
        return await database.CommunityInvites.AsNoTracking().Where(item => item.CommunityId == id).OrderByDescending(item => item.CreatedAt)
            .Select(item => new InviteSummary(item.Id.ToString(), item.MaxUses, item.Uses, item.ExpiresAt, item.RevokedAt != null)).ToArrayAsync(cancellationToken);
    }

    public async Task<InviteSummary> RevokeInviteAsync(Guid id, Guid inviteId, Guid user, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        var community = await LockAsync(id, cancellationToken);
        await OwnerAsync(community, user, cancellationToken);
        var invite = await database.CommunityInvites.SingleOrDefaultAsync(item => item.CommunityId == id && item.Id == inviteId, cancellationToken) ?? throw Missing();
        invite.RevokedAt ??= DateTimeOffset.UtcNow;
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
        var community = await database.Communities.AsNoTracking().SingleOrDefaultAsync(item => item.Id == id, cancellationToken) ?? throw Missing();
        await OwnerAsync(community, user, cancellationToken);
        return await database.Memberships.AsNoTracking().Where(member => member.CommunityId == id).OrderBy(member => member.JoinedAt)
            .Select(member => new MemberSummary(member.UserId.ToString(), member.User.DisplayName, member.Status, member.UserId == community.OwnerId)).ToArrayAsync(cancellationToken);
    }

    public async Task<MemberSummary> BanAsync(Guid id, Guid target, bool banned, Guid user, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        var community = await LockAsync(id, cancellationToken);
        await OwnerAsync(community, user, cancellationToken);
        if (target == community.OwnerId) throw new CommunityFailure(409, "The owner cannot be banned.");
        var member = await database.Memberships.Include(item => item.User).SingleOrDefaultAsync(item => item.CommunityId == id && item.UserId == target, cancellationToken) ?? throw Missing();
        var status = banned ? "Banned" : member.Status == "Banned" ? "Left" : member.Status;
        if (member.Status != status) { member.Status = status; community.PolicyVersion++; }
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new MemberSummary(target.ToString(), member.User.DisplayName, member.Status, false);
    }

    public async Task<bool> LeaveAsync(Guid id, Guid user, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        var community = await LockAsync(id, cancellationToken);
        if (community.OwnerId == user) throw new CommunityFailure(409, "The owner cannot leave this community.");
        var member = await database.Memberships.SingleOrDefaultAsync(item => item.CommunityId == id && item.UserId == user, cancellationToken);
        if (member is null || member.Status == "Banned") throw Missing();
        if (member.Status != "Left") { member.Status = "Left"; community.PolicyVersion++; }
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }
}
