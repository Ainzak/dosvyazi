using App.Api.Features.Accounts;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Gatherings;

public sealed class GatheringChecklistItem
{
    public Guid Id { get; set; }
    public Guid GatheringId { get; set; }
    public string Text { get; set; } = "";
    public Guid? AssigneeId { get; set; }
    public bool Done { get; set; }
    public bool Removed { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class GatheringReminder
{
    public Guid GatheringId { get; set; }
    public Guid UserId { get; set; }
    public long Version { get; set; }
    public int Revision { get; set; }
    public int? Minutes { get; set; }
    public DateTimeOffset? DueAt { get; set; }
    public DateTimeOffset? DeliveredAt { get; set; }
    public Guid? NoticeId { get; set; }
}
public static class PreparationModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<GatheringChecklistItem>(i => {
            i.Property(x => x.Text).HasMaxLength(160);
            i.HasIndex(x => new { x.GatheringId, x.CreatedAt, x.Id });
            i.HasOne<Gathering>().WithMany().HasForeignKey(x => x.GatheringId).OnDelete(DeleteBehavior.Restrict);
            i.HasOne<AppUser>().WithMany().HasForeignKey(x => x.AssigneeId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<GatheringReminder>(r => {
            r.HasKey(x => new { x.GatheringId, x.UserId });
            r.HasIndex(x => x.DueAt).HasFilter("\"DueAt\" IS NOT NULL");
            r.HasOne<Gathering>().WithMany().HasForeignKey(x => x.GatheringId).OnDelete(DeleteBehavior.Restrict);
            r.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            r.ToTable(t => t.HasCheckConstraint("CK_GatheringReminder_Values", "\"Version\" > 0 AND \"Revision\" > 0 AND (\"Minutes\" IS NULL OR \"Minutes\" IN (5,15,60,1440))"));
        });
    }
}
