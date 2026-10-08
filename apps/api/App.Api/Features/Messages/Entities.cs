using App.Api.Features.Accounts;
using App.Api.Features.Communities;

namespace App.Api.Features.Messages;

public sealed class Message
{
    public Guid Id { get; set; }
    public Guid ChannelId { get; set; }
    public TextChannel Channel { get; set; } = null!;
    public Guid AuthorId { get; set; }
    public AppUser Author { get; set; } = null!;
    public Guid ClientMessageId { get; set; }
    public long Sequence { get; set; }
    public string Content { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class ChannelEvent
{
    public Guid Id { get; set; }
    public Guid ChannelId { get; set; }
    public long Sequence { get; set; }
    public Guid MessageId { get; set; }
    public Message Message { get; set; } = null!;
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class OutboxEntry
{
    public Guid Id { get; set; }
    public Guid EventId { get; set; }
    public ChannelEvent Event { get; set; } = null!;
    public DateTimeOffset? PublishedAt { get; set; }
}
