using App.Api.Features.Accounts;

namespace App.Api.Features.DirectMessages;

public sealed class DirectConversation
{
    public Guid Id { get; set; }
    public Guid LowerUserId { get; set; }
    public Guid UpperUserId { get; set; }
    public long Sequence { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
public sealed class DirectMessage
{
    public Guid Id { get; set; }
    public Guid ConversationId { get; set; }
    public Guid AuthorId { get; set; }
    public AppUser Author { get; set; } = null!;
    public Guid ClientMessageId { get; set; }
    public long Sequence { get; set; }
    public long Version { get; set; } = 1;
    public string Content { get; set; } = "";
    public string RequestHash { get; set; } = "";
    public bool Deleted { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public DirectAttachment? Attachment { get; set; }
}
public sealed class DirectAttachment
{
    public Guid Id { get; set; }
    public Guid MessageId { get; set; }
    public DirectMessage Message { get; set; } = null!;
    public string Name { get; set; } = "";
    public string Hash { get; set; } = "";
    public long Size { get; set; }
    public string Kind { get; set; } = "File";
    public string? ContentType { get; set; }
    public int? DurationMs { get; set; }
    public bool Purged { get; set; }
    public Guid? SourceStickerId { get; set; }
    public string? StickerPackName { get; set; }
}
public sealed class DirectEvent
{
    public Guid Id { get; set; }
    public Guid ConversationId { get; set; }
    public long Sequence { get; set; }
    public Guid? MessageId { get; set; }
    public string Kind { get; set; } = "message.created";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
}
public sealed class DirectReadState
{
    public Guid ConversationId { get; set; }
    public Guid UserId { get; set; }
    public long Sequence { get; set; }
}
public sealed class UserBlock
{
    public Guid UserId { get; set; }
    public Guid BlockedUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class DirectCommand
{
    public Guid UserId { get; set; }
    public Guid ClientRequestId { get; set; }
    public Guid ConversationId { get; set; }
    public string Hash { get; set; } = "";
}
