using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;

namespace App.Api.Infrastructure.Persistence;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityUserContext<AppUser, Guid>(options)
{
    public DbSet<UserSession> Sessions => Set<UserSession>();
    public DbSet<Community> Communities => Set<Community>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<TextChannel> TextChannels => Set<TextChannel>();
    public DbSet<CommunityInvite> CommunityInvites => Set<CommunityInvite>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<Community>(community =>
        {
            community.Property(item => item.Name).HasMaxLength(80).IsRequired();
            community.HasOne<AppUser>().WithMany().HasForeignKey(item => item.OwnerId).OnDelete(DeleteBehavior.Restrict);
            community.HasIndex(item => new { item.OwnerId, item.ClientRequestId }).IsUnique();
        });
        builder.Entity<Membership>(member =>
        {
            member.HasKey(item => new { item.CommunityId, item.UserId });
            member.Property(item => item.Status).HasMaxLength(10).IsRequired();
            member.HasOne(item => item.Community).WithMany(item => item.Members).HasForeignKey(item => item.CommunityId).OnDelete(DeleteBehavior.Cascade);
            member.HasOne(item => item.User).WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Restrict);
            member.ToTable(table => table.HasCheckConstraint("CK_Memberships_Status", "\"Status\" IN ('Active', 'Banned', 'Left')"));
        });
        builder.Entity<TextChannel>(channel =>
        {
            channel.Property(item => item.Name).HasMaxLength(80).IsRequired();
            channel.HasOne(item => item.Community).WithMany(item => item.Channels).HasForeignKey(item => item.CommunityId).OnDelete(DeleteBehavior.Cascade);
            channel.HasIndex(item => new { item.CommunityId, item.Name }).IsUnique();
        });
        builder.Entity<CommunityInvite>(invite =>
        {
            invite.Property(item => item.CodeHash).HasMaxLength(64).IsRequired();
            invite.Property(item => item.ProtectedCode).IsRequired();
            invite.HasOne(item => item.Community).WithMany().HasForeignKey(item => item.CommunityId).OnDelete(DeleteBehavior.Cascade);
            invite.HasIndex(item => item.CodeHash).IsUnique();
            invite.HasIndex(item => new { item.CommunityId, item.ClientRequestId }).IsUnique();
            invite.ToTable(table => table.HasCheckConstraint("CK_CommunityInvites_Limits", "\"Uses\" >= 0 AND \"Uses\" <= \"MaxUses\" AND \"MaxUses\" BETWEEN 1 AND 100 AND \"LifetimeHours\" BETWEEN 1 AND 168"));
        });
        builder.Entity<AppUser>(user =>
        {
            user.Property(item => item.DisplayName).HasMaxLength(40).IsRequired();
            user.Property(item => item.Email).IsRequired();
            user.Property(item => item.NormalizedEmail).IsRequired();
            user.HasIndex(item => item.NormalizedEmail).IsUnique();
        });
        builder.Entity<UserSession>(session =>
        {
            session.HasKey(item => item.Id);
            session.HasOne(item => item.User).WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);
            session.HasIndex(item => new { item.UserId, item.ExpiresAt });
        });
    }
}
