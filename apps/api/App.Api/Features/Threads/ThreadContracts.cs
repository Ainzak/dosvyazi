using System.ComponentModel.DataAnnotations;
namespace App.Api.Features.Threads;

public sealed record CreateThreadRequest(Guid ClientRequestId, Guid RootMessageId, [Required, StringLength(80, MinimumLength = 2)] string Title);
public sealed record ChangeThreadRequest(Guid ClientRequestId, [Required] string ExpectedVersion, [Required, StringLength(80, MinimumLength = 2)] string Title, bool Archived);
public sealed record ThreadDto(string Id, string ParentChannelId, string RootMessageId, string Title, string CreatorId, DateTimeOffset CreatedAt,
    bool Archived, string Version, string Sequence, int MessageCount, int Unread, bool CanSend, bool CanManage, bool RootDeleted);
public sealed record ThreadPage(ThreadDto[] Threads, string? Before, bool HasMore);
public sealed class ThreadCommand
{
    public Guid ParentChannelId { get; set; }
    public Guid ActorId { get; set; }
    public Guid ClientRequestId { get; set; }
    public Guid ThreadId { get; set; }
    public string Hash { get; set; } = "";
}
