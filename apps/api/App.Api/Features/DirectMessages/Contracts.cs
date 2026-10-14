using System.ComponentModel.DataAnnotations;
using App.Api.Features.Messages;

namespace App.Api.Features.DirectMessages;

public sealed record StartDirectRequest(Guid ClientRequestId, Guid UserId);
public sealed record BlockDirectRequest(Guid ClientRequestId, bool Blocked);
public sealed record DirectConversationDto(string Id, string OtherUserId, string OtherName, string Sequence,
    int Unread, bool BlockedByMe, bool ContactUnavailable, DateTimeOffset UpdatedAt);
public sealed record DirectInbox(DirectConversationDto[] Conversations, string? Before, bool HasMore);
public sealed record DirectMessageDto(string Id, string ConversationId, string AuthorId, string AuthorName, string ClientMessageId,
    string Sequence, string Content, DateTimeOffset CreatedAt, string Version, DateTimeOffset? UpdatedAt, bool Deleted, AttachmentDto? Attachment);
public sealed record DirectSnapshot(DirectMessageDto[] Messages, string Watermark, bool HasOlder);
public sealed record DirectEventDto(string EventId, string ConversationId, string Sequence, string Kind, DirectMessageDto? Message);
public sealed record DirectCatchUp(DirectEventDto[] Events, string Watermark, string NextSequence, bool HasMore);
public sealed record DeleteDirectRequest(Guid ClientRequestId, [Required] string ExpectedVersion);
public sealed record DirectReadRequest([Required] string Sequence);
