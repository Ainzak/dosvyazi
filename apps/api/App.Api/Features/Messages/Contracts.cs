using System.ComponentModel.DataAnnotations;

namespace App.Api.Features.Messages;

public sealed record SendMessageRequest(Guid ClientMessageId, [Required, StringLength(4000, MinimumLength = 1)] string Content);
public sealed record MessageDto(string Id, string ChannelId, string AuthorId, string AuthorName, string ClientMessageId,
    string Sequence, string Content, DateTimeOffset CreatedAt);
public sealed record MessageSnapshot(MessageDto[] Messages, string Watermark, bool HasOlder);
public sealed record MessageEvent(string EventId, string ChannelId, string Sequence, string Kind, int SchemaVersion, MessageDto Payload);
public sealed record CatchUpPage(MessageEvent[] Events, string NextSequence, string Watermark, bool HasMore);
public sealed record ChannelHint(string EventId, string ChannelId, string Sequence, string Kind, int SchemaVersion);
