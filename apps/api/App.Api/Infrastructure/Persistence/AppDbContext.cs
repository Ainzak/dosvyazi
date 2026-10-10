using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Features.Voice;

namespace App.Api.Infrastructure.Persistence;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityUserContext<AppUser, Guid>(options)
{
    public DbSet<UserSession> Sessions => Set<UserSession>();
    public DbSet<Community> Communities => Set<Community>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<TextChannel> TextChannels => Set<TextChannel>();
    public DbSet<CommunityRole> CommunityRoles => Set<CommunityRole>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<MemberRole> MemberRoles => Set<MemberRole>();
    public DbSet<CategoryRoleRule> CategoryRoleRules => Set<CategoryRoleRule>();
    public DbSet<ChannelRoleRule> ChannelRoleRules => Set<ChannelRoleRule>();
    public DbSet<AccessChange> AccessChanges => Set<AccessChange>();
    public DbSet<VoiceRoleRule> VoiceRoleRules => Set<VoiceRoleRule>();
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();
    public DbSet<CommunityInvite> CommunityInvites => Set<CommunityInvite>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<MessageCommand> MessageCommands => Set<MessageCommand>();
    public DbSet<ChannelEvent> ChannelEvents => Set<ChannelEvent>();
    public DbSet<OutboxEntry> OutboxEntries => Set<OutboxEntry>();
    public DbSet<VoiceRoomBinding> VoiceRooms => Set<VoiceRoomBinding>();
    public DbSet<VoiceLease> VoiceLeases => Set<VoiceLease>();
    public DbSet<VoiceGrantRequest> VoiceGrantRequests => Set<VoiceGrantRequest>();
    public DbSet<RetiredVoiceRoom> RetiredVoiceRooms => Set<RetiredVoiceRoom>();
    public DbSet<VoiceWebhookReceipt> VoiceWebhookReceipts => Set<VoiceWebhookReceipt>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<CommunityRole>(role =>
        {
            role.HasAlternateKey(r => new { r.CommunityId, r.Id });
            role.Property(r => r.Name).HasMaxLength(80);
            role.HasOne<Community>().WithMany().HasForeignKey(r => r.CommunityId).OnDelete(DeleteBehavior.Restrict);
            role.ToTable(t => t.HasCheckConstraint("CK_CommunityRoles_Grants", "\"Grants\" BETWEEN 0 AND 16383 AND (\"Grants\" & 280) = 0 AND \"Rank\" BETWEEN 0 AND 1000"));
        });
        builder.Entity<Category>(category =>
        {
            category.HasAlternateKey(c => new { c.CommunityId, c.Id });
            category.Property(c => c.Name).HasMaxLength(80);
            category.HasOne<Community>().WithMany().HasForeignKey(c => c.CommunityId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<TextChannel>().HasAlternateKey(c => new { c.CommunityId, c.Id });
        builder.Entity<TextChannel>().HasOne<Category>().WithMany().HasForeignKey(c => new { c.CommunityId, c.CategoryId })
            .HasPrincipalKey(c => new { c.CommunityId, c.Id }).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<MemberRole>(member =>
        {
            member.HasKey(m => new { m.CommunityId, m.UserId, m.RoleId });
            member.HasOne<Membership>().WithMany().HasForeignKey(m => new { m.CommunityId, m.UserId }).OnDelete(DeleteBehavior.Cascade);
            member.HasOne<CommunityRole>().WithMany().HasForeignKey(m => new { m.CommunityId, m.RoleId }).HasPrincipalKey(r => new { r.CommunityId, r.Id }).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<CategoryRoleRule>(rule =>
        {
            rule.HasKey(r => new { r.CommunityId, r.CategoryId, r.RoleId });
            rule.HasOne<Category>().WithMany().HasForeignKey(r => new { r.CommunityId, r.CategoryId }).HasPrincipalKey(c => new { c.CommunityId, c.Id }).OnDelete(DeleteBehavior.Restrict);
            rule.HasOne<CommunityRole>().WithMany().HasForeignKey(r => new { r.CommunityId, r.RoleId }).HasPrincipalKey(r => new { r.CommunityId, r.Id }).OnDelete(DeleteBehavior.Restrict);
            rule.ToTable(t => t.HasCheckConstraint("CK_CategoryRoleRules_Bits", "\"Allow\" BETWEEN 0 AND 16383 AND \"Deny\" BETWEEN 0 AND 16383 AND ((\"Allow\" | \"Deny\") & 280) = 0"));
        });
        builder.Entity<ChannelRoleRule>(rule =>
        {
            rule.HasKey(r => new { r.CommunityId, r.ChannelId, r.RoleId });
            rule.HasOne<TextChannel>().WithMany().HasForeignKey(r => new { r.CommunityId, r.ChannelId }).HasPrincipalKey(c => new { c.CommunityId, c.Id }).OnDelete(DeleteBehavior.Restrict);
            rule.HasOne<CommunityRole>().WithMany().HasForeignKey(r => new { r.CommunityId, r.RoleId }).HasPrincipalKey(r => new { r.CommunityId, r.Id }).OnDelete(DeleteBehavior.Restrict);
            rule.ToTable(t => t.HasCheckConstraint("CK_ChannelRoleRules_Bits", "\"Allow\" BETWEEN 0 AND 16383 AND \"Deny\" BETWEEN 0 AND 16383 AND ((\"Allow\" | \"Deny\") & 280) = 0"));
        });
        builder.Entity<Community>().HasOne<Category>().WithMany().HasForeignKey(c => new { c.Id, c.VoiceCategoryId }).HasPrincipalKey(c => new { c.CommunityId, c.Id }).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<VoiceRoleRule>(rule =>
        {
            rule.HasKey(r => new { r.CommunityId, r.RoleId });
            rule.HasOne<CommunityRole>().WithMany().HasForeignKey(r => new { r.CommunityId, r.RoleId }).HasPrincipalKey(r => new { r.CommunityId, r.Id }).OnDelete(DeleteBehavior.Restrict);
            rule.ToTable(t => t.HasCheckConstraint("CK_VoiceRoleRules_Bits", "\"Allow\" BETWEEN 0 AND 16383 AND \"Deny\" BETWEEN 0 AND 16383 AND ((\"Allow\" | \"Deny\") & 280) = 0"));
        });
        builder.Entity<AuditEntry>(audit =>
        {
            audit.Property(a => a.Action).HasMaxLength(80);
            audit.HasIndex(a => new { a.CommunityId, a.CreatedAt, a.Id });
            audit.HasOne<Community>().WithMany().HasForeignKey(a => a.CommunityId).OnDelete(DeleteBehavior.Restrict);
            audit.HasOne<AppUser>().WithMany().HasForeignKey(a => a.ActorId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<AccessChange>(change =>
        {
            change.HasKey(c => new { c.CommunityId, c.ClientRequestId });
            change.Property(c => c.Hash).HasMaxLength(64);
            change.HasOne<Community>().WithMany().HasForeignKey(c => c.CommunityId).OnDelete(DeleteBehavior.Restrict);
            change.HasOne<AppUser>().WithMany().HasForeignKey(c => c.ActorId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<VoiceWebhookReceipt>(receipt =>
        {
            receipt.Property(item => item.Id).HasMaxLength(128);
            receipt.Property(item => item.BodyHash).HasMaxLength(64);
        });
        builder.Entity<VoiceRoomBinding>(room =>
        {
            room.HasKey(item => item.CommunityId);
            room.HasIndex(item => item.Id).IsUnique();
            room.HasIndex(item => item.NextCheckAt);
            room.Property(item => item.Status).HasMaxLength(10);
            room.HasOne<Community>().WithOne().HasForeignKey<VoiceRoomBinding>(item => item.CommunityId).OnDelete(DeleteBehavior.Restrict);
            room.ToTable(table => table.HasCheckConstraint("CK_VoiceRooms_State", "\"Generation\" > 0 AND \"Status\" IN ('Ready', 'Pending')"));
        });
        builder.Entity<VoiceLease>(lease =>
        {
            lease.HasIndex(item => item.UserId).IsUnique().HasFilter("\"Active\"");
            lease.HasIndex(item => new { item.CommunityId, item.Active });
            lease.HasOne<AppUser>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Restrict);
            lease.HasOne<Community>().WithMany().HasForeignKey(item => item.CommunityId).OnDelete(DeleteBehavior.Restrict);
            lease.HasOne<UserSession>().WithMany().HasForeignKey(item => item.AuthSessionId).OnDelete(DeleteBehavior.Restrict);
            lease.Property(item => item.SecurityStamp).HasMaxLength(256);
        });
        builder.Entity<VoiceGrantRequest>(request =>
        {
            request.HasKey(item => new { item.UserId, item.ClientRequestId });
            request.HasOne(item => item.Lease).WithMany().HasForeignKey(item => item.LeaseId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<RetiredVoiceRoom>(room =>
        {
            room.HasKey(item => new { item.RoomId, item.Generation });
            room.HasOne<Community>().WithMany().HasForeignKey(item => item.CommunityId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<Message>(message =>
        {
            message.Property(item => item.Content).HasMaxLength(4000).IsRequired();
            message.HasOne(item => item.Channel).WithMany().HasForeignKey(item => item.ChannelId).OnDelete(DeleteBehavior.Restrict);
            message.HasOne(item => item.Author).WithMany().HasForeignKey(item => item.AuthorId).OnDelete(DeleteBehavior.Restrict);
            message.HasIndex(item => new { item.AuthorId, item.ChannelId, item.ClientMessageId }).IsUnique();
            message.HasIndex(item => new { item.ChannelId, item.Sequence }).IsUnique();
            message.HasAlternateKey(item => new { item.Id, item.ChannelId });
            message.Property(item => item.OriginalContentHash).HasMaxLength(64);
            message.ToTable(table => table.HasCheckConstraint("CK_Messages_Sequence", "\"Sequence\" > 0"));
        });
        builder.Entity<ChannelEvent>(change =>
        {
            change.HasOne(item => item.Message).WithMany().HasForeignKey(item => new { item.MessageId, item.ChannelId })
                .HasPrincipalKey(item => new { item.Id, item.ChannelId }).OnDelete(DeleteBehavior.Restrict);
            change.Property(item => item.Kind).HasMaxLength(32);
            change.HasIndex(item => new { item.ChannelId, item.Sequence }).IsUnique();
        });
        builder.Entity<MessageCommand>(command =>
        {
            command.HasKey(c => new { c.ChannelId, c.ActorId, c.ClientRequestId });
            command.Property(c => c.Hash).HasMaxLength(64);
            command.HasOne<Message>().WithMany().HasForeignKey(c => new { c.MessageId, c.ChannelId }).HasPrincipalKey(m => new { m.Id, m.ChannelId }).OnDelete(DeleteBehavior.Restrict);
            command.HasOne<AppUser>().WithMany().HasForeignKey(c => c.ActorId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<OutboxEntry>(entry =>
        {
            entry.HasOne(item => item.Event).WithMany().HasForeignKey(item => item.EventId).OnDelete(DeleteBehavior.Restrict);
            entry.HasIndex(item => item.EventId).IsUnique();
            entry.HasIndex(item => item.PublishedAt).HasFilter("\"PublishedAt\" IS NULL");
        });
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
