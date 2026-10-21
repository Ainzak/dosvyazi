using System.ComponentModel.DataAnnotations;
namespace App.Api.Features.Forums;

public sealed record CreateForumTopicRequest(Guid ClientRequestId, [Required, StringLength(80, MinimumLength = 2)] string Title, [Required, StringLength(4000, MinimumLength = 1)] string Content);
public sealed record ChangeForumTopicRequest(Guid ClientRequestId, [Required] string ExpectedVersion, [Required, StringLength(80, MinimumLength = 2)] string Title, bool Archived);
public sealed record ForumTopicDto(string Id, string ForumId, string Title, string CreatorId, DateTimeOffset CreatedAt, bool Archived, string Version, string Sequence, int MessageCount, int Unread, bool CanSend, bool CanManage);
public sealed record ForumTopicPage(ForumTopicDto[] Topics, string? Before, bool HasMore);
public sealed class ForumTopicCommand
{
    public Guid ForumId { get; set; }
    public Guid ActorId { get; set; }
    public Guid ClientRequestId { get; set; }
    public Guid TopicId { get; set; }
    public string Hash { get; set; } = "";
}
