using System.ComponentModel.DataAnnotations;

namespace App.Api.Features.Messages;

public sealed record SendMessageRequest(Guid ClientMessageId, [Required, StringLength(4000, MinimumLength = 1)] string Content);
public sealed record MessageDto(string Id, string ChannelId, string AuthorId, string AuthorName, string ClientMessageId,
    string Sequence, string Content, DateTimeOffset CreatedAt, string Version = "1", DateTimeOffset? UpdatedAt = null, bool Deleted = false);
public sealed record MessageSnapshot(MessageDto[] Messages, string Watermark, bool HasOlder);
public sealed record MessageEvent(string EventId, string ChannelId, string Sequence, string Kind, int SchemaVersion, MessageDto? Payload, string MessageId = "", string Version = "1");
public sealed record CatchUpPage(MessageEvent[] Events, string NextSequence, string Watermark, bool HasMore);
public sealed record ChannelHint(string EventId, string ChannelId, string Sequence, string Kind, int SchemaVersion);
public sealed record EditMessageRequest(Guid ClientRequestId, [Required] string ExpectedVersion, [Required, StringLength(4000, MinimumLength = 1)] string Content);
public sealed record DeleteMessageRequest(Guid ClientRequestId, [Required] string ExpectedVersion);
public sealed record MessageCommandResult(string MessageId, string AppliedVersion, MessageDto Current);
