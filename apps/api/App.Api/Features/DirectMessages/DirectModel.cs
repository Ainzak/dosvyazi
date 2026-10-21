using App.Api.Features.Accounts;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.DirectMessages;

public static class DirectModel
{
    public static void Configure(ModelBuilder builder)
    {
        builder.Entity<DirectConversation>(c =>
        {
            c.HasIndex(x => new { x.LowerUserId, x.UpperUserId }).IsUnique();
            c.HasOne<AppUser>().WithMany().HasForeignKey(x => x.LowerUserId).OnDelete(DeleteBehavior.Restrict);
            c.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UpperUserId).OnDelete(DeleteBehavior.Restrict);
            c.HasIndex(x => new { x.LowerUserId, x.UpdatedAt }); c.HasIndex(x => new { x.UpperUserId, x.UpdatedAt });
            c.ToTable(t => t.HasCheckConstraint("CK_DirectConversations_Pair", "\"LowerUserId\" < \"UpperUserId\" AND \"Sequence\" >= 0"));
        });
        builder.Entity<DirectMessage>(m =>
        {
            m.HasOne<DirectConversation>().WithMany().HasForeignKey(x => x.ConversationId).OnDelete(DeleteBehavior.Restrict);
            m.HasOne(x => x.Author).WithMany().HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
            m.HasIndex(x => new { x.ConversationId, x.AuthorId, x.ClientMessageId }).IsUnique();
            m.HasIndex(x => new { x.ConversationId, x.Sequence }).IsUnique();
            m.HasIndex(x => new { x.AuthorId, x.CreatedAt });
            m.Property(x => x.Content).HasMaxLength(4000); m.Property(x => x.RequestHash).HasMaxLength(64);
            m.ToTable(t => t.HasCheckConstraint("CK_DirectMessages_Sequence", "\"Sequence\" > 0 AND \"Version\" > 0"));
        });
        builder.Entity<DirectAttachment>(a =>
        {
            a.HasOne(x => x.Message).WithOne(x => x.Attachment).HasForeignKey<DirectAttachment>(x => x.MessageId).OnDelete(DeleteBehavior.Restrict);
            a.Property(x => x.Name).HasMaxLength(120); a.Property(x => x.Hash).HasMaxLength(64); a.Property(x => x.Kind).HasMaxLength(8); a.Property(x => x.ContentType).HasMaxLength(32);
            a.ToTable(t => t.HasCheckConstraint("CK_DirectAttachments_Size", "\"Size\" BETWEEN 1 AND 5242880"));
            a.ToTable(t => t.HasCheckConstraint("CK_DirectAttachments_Media", "(\"Kind\" = 'File' AND \"ContentType\" IS NULL AND \"DurationMs\" IS NULL) OR (\"Kind\" = 'Voice' AND \"ContentType\" = 'audio/webm;codecs=opus' AND \"ContentType\" IS NOT NULL AND \"DurationMs\" IS NOT NULL AND \"DurationMs\" BETWEEN 1 AND 60000 AND \"Size\" <= 2097152) OR (\"Kind\" = 'Sticker' AND \"ContentType\" IS NOT NULL AND \"ContentType\" IN ('image/png', 'image/gif') AND \"DurationMs\" IS NULL AND \"SourceStickerId\" IS NOT NULL AND \"StickerPackName\" IS NOT NULL AND ((\"ContentType\" = 'image/png' AND \"Size\" <= 1048576) OR (\"ContentType\" = 'image/gif' AND \"Size\" <= 3145728)))"));
            a.Property(x => x.StickerPackName).HasMaxLength(32);
            a.HasOne<App.Api.Features.Stickers.StickerAsset>().WithMany().HasForeignKey(x => x.SourceStickerId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<DirectEvent>(e =>
        {
            e.HasOne<DirectConversation>().WithMany().HasForeignKey(x => x.ConversationId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<DirectMessage>().WithMany().HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.ConversationId, x.Sequence }).IsUnique(); e.HasIndex(x => x.PublishedAt).HasFilter("\"PublishedAt\" IS NULL");
            e.Property(x => x.Kind).HasMaxLength(32);
        });
        builder.Entity<DirectReadState>(s =>
        {
            s.HasKey(x => new { x.ConversationId, x.UserId });
            s.HasOne<DirectConversation>().WithMany().HasForeignKey(x => x.ConversationId).OnDelete(DeleteBehavior.Restrict);
            s.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            s.ToTable(t => t.HasCheckConstraint("CK_DirectReadStates_Sequence", "\"Sequence\" >= 0"));
        });
        builder.Entity<UserBlock>(b =>
        {
            b.HasKey(x => new { x.UserId, x.BlockedUserId });
            b.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            b.HasOne<AppUser>().WithMany().HasForeignKey(x => x.BlockedUserId).OnDelete(DeleteBehavior.Restrict);
            b.ToTable(t => t.HasCheckConstraint("CK_UserBlocks_DifferentUsers", "\"UserId\" <> \"BlockedUserId\""));
        });
        builder.Entity<DirectCommand>(c =>
        {
            c.HasKey(x => new { x.UserId, x.ClientRequestId }); c.Property(x => x.Hash).HasMaxLength(64);
            c.HasOne<DirectConversation>().WithMany().HasForeignKey(x => x.ConversationId).OnDelete(DeleteBehavior.Restrict);
            c.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
