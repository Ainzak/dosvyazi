using App.Api.Features.Accounts;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Stickers;

public sealed class StickerPack
{
    public Guid Id { get; set; }
    public Guid? OwnerId { get; set; }
    public bool BuiltIn { get; set; }
    public string Name { get; set; } = "";
    public string Title { get; set; } = "";
    public Guid ClientRequestId { get; set; }
    public string RequestHash { get; set; } = "";
    public bool Deleted { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class StickerAsset
{
    public Guid Id { get; set; }
    public Guid PackId { get; set; }
    public StickerPack Pack { get; set; } = null!;
    public Guid ClientRequestId { get; set; }
    public string Label { get; set; } = "";
    public string Filename { get; set; } = "";
    public string ContentType { get; set; } = "";
    public string Hash { get; set; } = "";
    public string RequestHash { get; set; } = "";
    public long Size { get; set; }
    public bool Deleted { get; set; }
    public bool Purged { get; set; }
}
public sealed class SavedStickerPack
{
    public Guid UserId { get; set; }
    public Guid PackId { get; set; }
}
public static class StickerModel
{
    public static void Configure(ModelBuilder model)
    {
        model.Entity<StickerPack>(p =>
        {
            p.HasIndex(x => x.Name).IsUnique(); p.HasIndex(x => new { x.OwnerId, x.ClientRequestId }).IsUnique();
            p.HasOne<AppUser>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Restrict);
            p.Property(x => x.Name).HasMaxLength(32); p.Property(x => x.Title).HasMaxLength(64); p.Property(x => x.RequestHash).HasMaxLength(64);
            p.ToTable(t => t.HasCheckConstraint("CK_StickerPacks_Owner", "(\"BuiltIn\" AND \"OwnerId\" IS NULL) OR (NOT \"BuiltIn\" AND \"OwnerId\" IS NOT NULL)"));
        });
        model.Entity<StickerAsset>(s =>
        {
            s.HasOne(x => x.Pack).WithMany().HasForeignKey(x => x.PackId).OnDelete(DeleteBehavior.Restrict);
            s.HasIndex(x => new { x.PackId, x.ClientRequestId }).IsUnique();
            s.Property(x => x.Label).HasMaxLength(64); s.Property(x => x.Filename).HasMaxLength(120); s.Property(x => x.ContentType).HasMaxLength(16);
            s.Property(x => x.Hash).HasMaxLength(64); s.Property(x => x.RequestHash).HasMaxLength(64);
            s.ToTable(t => t.HasCheckConstraint("CK_StickerAssets_Media", "(\"ContentType\" = 'image/png' AND \"Size\" BETWEEN 1 AND 1048576) OR (\"ContentType\" = 'image/gif' AND \"Size\" BETWEEN 1 AND 3145728)"));
        });
        model.Entity<SavedStickerPack>(s =>
        {
            s.HasKey(x => new { x.UserId, x.PackId });
            s.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            s.HasOne<StickerPack>().WithMany().HasForeignKey(x => x.PackId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
