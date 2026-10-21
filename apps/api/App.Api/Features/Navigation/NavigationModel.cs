using App.Api.Features.Accounts;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Navigation;

public sealed class ConversationPreference
{
    public Guid UserId { get; set; }
    public string Kind { get; set; } = "channel";
    public Guid ContainerId { get; set; }
    public string Mode { get; set; } = "mentions";
}
public sealed class MessageBookmark
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Kind { get; set; } = "channel";
    public Guid ContainerId { get; set; }
    public Guid MessageId { get; set; }
    public string Note { get; set; } = "";
    public string[] Tags { get; set; } = [];
    public bool Removed { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class MessageNotice
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Kind { get; set; } = "channel";
    public Guid ContainerId { get; set; }
    public Guid MessageId { get; set; }
    public bool Mention { get; set; }
    public bool Read { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class NavigationCommand
{
    public Guid UserId { get; set; }
    public Guid ClientRequestId { get; set; }
    public string Hash { get; set; } = "";
}
public static class NavigationModel
{
    public static void Configure(ModelBuilder model)
    {
        model.Entity<ConversationPreference>(p => {
            p.HasKey(x => new { x.UserId, x.Kind, x.ContainerId }); p.Property(x => x.Kind).HasMaxLength(8); p.Property(x => x.Mode).HasMaxLength(8);
            p.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            p.ToTable(t => { t.HasCheckConstraint("CK_ConversationPreference_Kind", "\"Kind\" IN ('channel','direct')"); t.HasCheckConstraint("CK_ConversationPreference_Mode", "\"Mode\" IN ('all','mentions','quiet')"); });
        });
        model.Entity<MessageBookmark>(b => {
            b.HasIndex(x => new { x.UserId, x.Kind, x.MessageId }).IsUnique(); b.HasIndex(x => new { x.UserId, x.CreatedAt, x.Id });
            b.Property(x => x.Kind).HasMaxLength(8); b.Property(x => x.Note).HasMaxLength(500);
            b.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<MessageNotice>(n => {
            n.HasIndex(x => new { x.UserId, x.Kind, x.MessageId }).IsUnique(); n.HasIndex(x => new { x.UserId, x.CreatedAt, x.Id }); n.Property(x => x.Kind).HasMaxLength(8);
            n.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<NavigationCommand>(c => {
            c.HasKey(x => new { x.UserId, x.ClientRequestId }); c.Property(x => x.Hash).HasMaxLength(64);
            c.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
