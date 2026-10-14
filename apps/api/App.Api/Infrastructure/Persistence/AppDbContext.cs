using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Features.Voice;
using App.Api.Features.Gatherings;

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
    public DbSet<MessageAttachment> MessageAttachments => Set<MessageAttachment>();
    public DbSet<Gathering> Gatherings => Set<Gathering>();
    public DbSet<GatheringInvite> GatheringInvites => Set<GatheringInvite>();
    public DbSet<GatheringComment> GatheringComments => Set<GatheringComment>();
    public DbSet<GatheringRevision> GatheringRevisions => Set<GatheringRevision>();
    public DbSet<GatheringCommand> GatheringCommands => Set<GatheringCommand>();
    public DbSet<GatheringNotice> GatheringNotices => Set<GatheringNotice>();
    public DbSet<GatheringEvent> GatheringEvents => Set<GatheringEvent>();
    public DbSet<GatheringCover> GatheringCovers => Set<GatheringCover>();
    public DbSet<MessageReaction> MessageReactions => Set<MessageReaction>();
    public DbSet<ChannelReadState> ChannelReadStates => Set<ChannelReadState>();
    public DbSet<CommunityEmoji> CommunityEmojis => Set<CommunityEmoji>();
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
        builder.Entity<Gathering>(g =>
        {
            g.HasAlternateKey(x => new { x.CommunityId, x.Id });
            g.Property(x => x.Title).HasMaxLength(80); g.Property(x => x.Description).HasMaxLength(2000); g.Property(x => x.Game).HasMaxLength(80);
            g.Property(x => x.LocalStart).HasMaxLength(16); g.Property(x => x.TimeZoneId).HasMaxLength(100); g.Property(x => x.Status).HasMaxLength(16);
            g.HasIndex(x => new { x.CommunityId, x.CreatedAt, x.Id });
            g.HasOne<Community>().WithMany().HasForeignKey(x => x.CommunityId).OnDelete(DeleteBehavior.Restrict);
            g.HasOne<AppUser>().WithMany().HasForeignKey(x => x.OrganizerId).OnDelete(DeleteBehavior.Restrict);
            g.ToTable(t => t.HasCheckConstraint("CK_Gatherings_State", "\"Revision\" > 0 AND \"Version\" > 0 AND \"Status\" IN ('Scheduled','Cancelled','Completed')"));
        });
        builder.Entity<GatheringInvite>(i =>
        {
            i.HasKey(x => new { x.GatheringId, x.UserId }); i.Property(x => x.State).HasMaxLength(20);
            i.HasOne(x => x.Gathering).WithMany(x => x.Invites).HasForeignKey(x => x.GatheringId).OnDelete(DeleteBehavior.Restrict);
            i.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            i.ToTable(t => t.HasCheckConstraint("CK_GatheringInvites_State", "\"State\" IN ('Pending','Accepted','Declined','NeedsClarification')"));
        });
        builder.Entity<GatheringComment>(c =>
        {
            c.Property(x => x.Text).HasMaxLength(2000); c.HasIndex(x => new { x.GatheringId, x.CreatedAt, x.Id });
            c.HasIndex(x => new { x.GatheringId, x.Sequence }).IsUnique();
            c.HasOne<Gathering>().WithMany().HasForeignKey(x => x.GatheringId).OnDelete(DeleteBehavior.Restrict);
            c.HasOne<AppUser>().WithMany().HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<GatheringRevision>().HasKey(x => new { x.GatheringId, x.Revision });
        builder.Entity<GatheringRevision>().HasOne<Gathering>().WithMany().HasForeignKey(x => x.GatheringId).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<GatheringCommand>(c =>
        {
            c.HasKey(x => new { x.CommunityId, x.ActorId, x.ClientRequestId }); c.Property(x => x.Hash).HasMaxLength(64);
            c.HasOne<Gathering>().WithMany().HasForeignKey(x => new { x.CommunityId, x.GatheringId }).HasPrincipalKey(x => new { x.CommunityId, x.Id }).OnDelete(DeleteBehavior.Restrict);
            c.HasOne<AppUser>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<GatheringNotice>(n =>
        {
            n.Property(x => x.Kind).HasMaxLength(32); n.HasIndex(x => new { x.UserId, x.CreatedAt });
            n.HasOne<Gathering>().WithMany().HasForeignKey(x => x.GatheringId).OnDelete(DeleteBehavior.Restrict);
            n.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<GatheringEvent>().HasIndex(x => x.PublishedAt).HasFilter("\"PublishedAt\" IS NULL");
        builder.Entity<GatheringEvent>().HasOne<Gathering>().WithMany().HasForeignKey(x => new { x.CommunityId, x.GatheringId }).HasPrincipalKey(x => new { x.CommunityId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<GatheringCover>().HasOne<Gathering>().WithMany().HasForeignKey(x => x.GatheringId).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<GatheringCover>().Property(x => x.ContentType).HasMaxLength(20);
        builder.Entity<Message>().HasGeneratedTsVectorColumn(m => m.SearchVector, "simple", m => m.Content).HasIndex(m => m.SearchVector).HasMethod("GIN");
        builder.Entity<MessageReaction>(reaction =>
        {
            reaction.HasKey(r => new { r.MessageId, r.UserId, r.Emoji });
            reaction.Property(r => r.Emoji).HasMaxLength(80);
            reaction.HasOne(r => r.Message).WithMany(m => m.Reactions).HasForeignKey(r => r.MessageId).OnDelete(DeleteBehavior.Cascade);
            reaction.HasOne<AppUser>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<ChannelReadState>(state =>
        {
            state.HasKey(s => new { s.ChannelId, s.UserId });
            state.HasOne<TextChannel>().WithMany().HasForeignKey(s => s.ChannelId).OnDelete(DeleteBehavior.Cascade);
            state.HasOne<AppUser>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Restrict);
            state.ToTable(t => t.HasCheckConstraint("CK_ChannelReadStates_Sequence", "\"Sequence\" >= 0"));
        });
        builder.Entity<CommunityEmoji>(emoji =>
        {
            emoji.Property(e => e.Name).HasMaxLength(32); emoji.Property(e => e.Hash).HasMaxLength(64);
            emoji.HasIndex(e => new { e.CommunityId, e.Name }).IsUnique().HasFilter("NOT \"Deleted\"");
            emoji.HasIndex(e => new { e.CommunityId, e.ClientRequestId }).IsUnique();
            emoji.HasOne<Community>().WithMany().HasForeignKey(e => e.CommunityId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<AppUser>().Property(u => u.About).HasMaxLength(1000);
        builder.Entity<AppUser>().Property(u => u.Interests).HasMaxLength(500);
        builder.Entity<AppUser>().Property(u => u.Games).HasMaxLength(500);
        builder.Entity<AppUser>().Property(u => u.LookingFor).HasMaxLength(500);
        builder.Entity<MessageAttachment>(attachment =>
        {
            attachment.HasOne(a => a.Message).WithOne(m => m.Attachment).HasForeignKey<MessageAttachment>(a => a.MessageId).OnDelete(DeleteBehavior.Restrict);
            attachment.Property(a => a.Name).HasMaxLength(120);
            attachment.Property(a => a.Hash).HasMaxLength(64);
            attachment.Property(a => a.Kind).HasMaxLength(8);
            attachment.Property(a => a.ContentType).HasMaxLength(32);
            attachment.ToTable(t => t.HasCheckConstraint("CK_MessageAttachments_Media", "(\"Kind\" = 'File' AND \"ContentType\" IS NULL AND \"DurationMs\" IS NULL) OR (\"Kind\" = 'Voice' AND \"ContentType\" IS NOT NULL AND \"ContentType\" = 'audio/webm;codecs=opus' AND \"DurationMs\" IS NOT NULL AND \"DurationMs\" BETWEEN 1 AND 60000 AND \"Size\" <= 2097152)"));
            attachment.ToTable(t => t.HasCheckConstraint("CK_MessageAttachments_Size", "\"Size\" BETWEEN 1 AND 5242880"));
        });
        builder.Entity<CommunityRole>(role =>
        {
            role.HasAlternateKey(r => new { r.CommunityId, r.Id });
            role.Property(r => r.Name).HasMaxLength(80);
            role.HasOne<Community>().WithMany().HasForeignKey(r => r.CommunityId).OnDelete(DeleteBehavior.Restrict);
            role.ToTable(t => t.HasCheckConstraint("CK_CommunityRoles_Grants", "\"Grants\" BETWEEN 0 AND 65535 AND (\"Grants\" & 280) = 0 AND \"Rank\" BETWEEN 0 AND 1000"));
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
            rule.ToTable(t => t.HasCheckConstraint("CK_CategoryRoleRules_Bits", "\"Allow\" BETWEEN 0 AND 65535 AND \"Deny\" BETWEEN 0 AND 65535 AND ((\"Allow\" | \"Deny\") & 280) = 0"));
        });
        builder.Entity<ChannelRoleRule>(rule =>
        {
            rule.HasKey(r => new { r.CommunityId, r.ChannelId, r.RoleId });
            rule.HasOne<TextChannel>().WithMany().HasForeignKey(r => new { r.CommunityId, r.ChannelId }).HasPrincipalKey(c => new { c.CommunityId, c.Id }).OnDelete(DeleteBehavior.Restrict);
            rule.HasOne<CommunityRole>().WithMany().HasForeignKey(r => new { r.CommunityId, r.RoleId }).HasPrincipalKey(r => new { r.CommunityId, r.Id }).OnDelete(DeleteBehavior.Restrict);
            rule.ToTable(t => t.HasCheckConstraint("CK_ChannelRoleRules_Bits", "\"Allow\" BETWEEN 0 AND 65535 AND \"Deny\" BETWEEN 0 AND 65535 AND ((\"Allow\" | \"Deny\") & 280) = 0"));
        });
        builder.Entity<Community>().HasOne<Category>().WithMany().HasForeignKey(c => new { c.Id, c.VoiceCategoryId }).HasPrincipalKey(c => new { c.CommunityId, c.Id }).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<VoiceRoleRule>(rule =>
        {
            rule.HasKey(r => new { r.CommunityId, r.RoleId });
            rule.HasOne<CommunityRole>().WithMany().HasForeignKey(r => new { r.CommunityId, r.RoleId }).HasPrincipalKey(r => new { r.CommunityId, r.Id }).OnDelete(DeleteBehavior.Restrict);
            rule.ToTable(t => t.HasCheckConstraint("CK_VoiceRoleRules_Bits", "\"Allow\" BETWEEN 0 AND 65535 AND \"Deny\" BETWEEN 0 AND 65535 AND ((\"Allow\" | \"Deny\") & 280) = 0"));
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
