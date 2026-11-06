using App.Api.Features.Accounts;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.DirectMessages;

public sealed class DirectCall
{
    public Guid Id { get; set; }
    public Guid ConversationId { get; set; }
    public Guid CallerId { get; set; }
    public Guid RecipientId { get; set; }
    public Guid ClientRequestId { get; set; }
    public string Status { get; set; } = "Ringing";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset RingUntil { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
    public string EndReason { get; set; } = "";
    public bool Cleaned { get; set; }
    public DateTimeOffset NextCheckAt { get; set; }
    public Guid? AdmissionAttempt { get; set; }
    public DateTimeOffset? AdmissionDeadline { get; set; }
}
public sealed class DirectCallMember
{
    public Guid Id { get; set; }
    public Guid CallId { get; set; }
    public Guid UserId { get; set; }
    public Guid SessionId { get; set; }
    public string SecurityStamp { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
}
public sealed record StartCallRequest(Guid ClientRequestId);
public sealed record DirectCallDto(string Id, string ConversationId, string CallerId, string OtherName, string Status, DateTimeOffset RingUntil, string EndReason, bool CanJoin);

public static class DirectCallModel
{
    public static void Configure(ModelBuilder model)
    {
        model.Entity<DirectCall>(call =>
        {
            call.ToTable("DirectCalls", table => table.HasCheckConstraint("CK_DirectCalls_Status", "\"Status\" IN ('Ringing','Active','Ended') AND \"CallerId\" <> \"RecipientId\""));
            call.HasKey(x => x.Id);
            call.HasOne<DirectConversation>().WithMany().HasForeignKey(x => x.ConversationId).OnDelete(DeleteBehavior.Restrict);
            call.HasOne<AppUser>().WithMany().HasForeignKey(x => x.CallerId).OnDelete(DeleteBehavior.Restrict);
            call.HasOne<AppUser>().WithMany().HasForeignKey(x => x.RecipientId).OnDelete(DeleteBehavior.Restrict);
            call.HasIndex(x => new { x.CallerId, x.ClientRequestId }).IsUnique();
            call.HasIndex(x => new { x.CallerId, x.Status }); call.HasIndex(x => new { x.RecipientId, x.Status });
            call.HasIndex(x => new { x.Cleaned, x.NextCheckAt });
            call.Property(x => x.Status).HasMaxLength(8); call.Property(x => x.EndReason).HasMaxLength(32);
        });
        model.Entity<DirectCallMember>(member =>
        {
            member.ToTable("DirectCallMembers"); member.HasKey(x => x.Id);
            member.HasOne<DirectCall>().WithMany().HasForeignKey(x => x.CallId).OnDelete(DeleteBehavior.Restrict);
            member.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            member.HasOne<UserSession>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Restrict);
            member.Property(x => x.SecurityStamp).HasMaxLength(256);
            member.HasIndex(x => new { x.CallId, x.UserId }).IsUnique();
        });
    }
}
