using App.Api.Features.Accounts;
using Microsoft.EntityFrameworkCore;
namespace App.Api.Features.Gatherings;
public sealed class GatheringPoll
{
    public Guid Id { get; set; }
    public Guid GatheringId { get; set; }
    public string Kind { get; set; } = "";
    public int Revision { get; set; }
    public bool Closed { get; set; }
    public Guid? SelectedOptionId { get; set; }
    public List<GatheringPollOption> Options { get; set; } = [];
}
public sealed class GatheringPollOption
{
    public Guid Id { get; set; }
    public Guid PollId { get; set; }
    public int Position { get; set; }
    public string Game { get; set; } = "";
    public string LocalStart { get; set; } = "";
    public string TimeZoneId { get; set; } = "";
    public DateTimeOffset? StartAt { get; set; }
}
public sealed class GatheringPollVote
{
    public Guid PollId { get; set; }
    public Guid UserId { get; set; }
    public long Version { get; set; }
    public Guid[] Options { get; set; } = [];
}
public static class AttendanceModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<Gathering>().ToTable(t => t.HasCheckConstraint("CK_Gathering_Capacity", "\"Capacity\" IS NULL OR \"Capacity\" BETWEEN 1 AND 51"));
        b.Entity<GatheringPoll>(p => {
            p.Property(x => x.Kind).HasMaxLength(8); p.HasIndex(x => x.GatheringId);
            p.HasOne<Gathering>().WithMany().HasForeignKey(x => x.GatheringId).OnDelete(DeleteBehavior.Restrict);
            p.HasMany(x => x.Options).WithOne().HasForeignKey(x => x.PollId).OnDelete(DeleteBehavior.Restrict);
            p.ToTable(t => t.HasCheckConstraint("CK_GatheringPoll_Kind", "\"Kind\" IN ('Time','Game') AND \"Revision\" > 0"));
        });
        b.Entity<GatheringPollOption>(o => { o.Property(x => x.Game).HasMaxLength(80); o.Property(x => x.LocalStart).HasMaxLength(16); o.Property(x => x.TimeZoneId).HasMaxLength(100); o.HasIndex(x => new { x.PollId, x.Position }).IsUnique(); });
        b.Entity<GatheringPollVote>(v => { v.HasKey(x => new { x.PollId, x.UserId }); v.HasOne<GatheringPoll>().WithMany().HasForeignKey(x => x.PollId).OnDelete(DeleteBehavior.Restrict); v.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict); });
    }
}
