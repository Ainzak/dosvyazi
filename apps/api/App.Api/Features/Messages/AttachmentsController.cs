using System.Security.Claims;
using App.Api.Features.Communities;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Messages;

[ApiController, Authorize, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/v1/communities/{community:guid}/channels/{channel:guid}")]
public sealed class AttachmentsController(MessageService messages, AppDbContext database, AttachmentStore files) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost("stickers"), EnableRateLimiting("direct-commands"), RequestSizeLimit(32768)]
    public async Task<ActionResult<MessageDto>> SendSticker(App.Api.Features.Stickers.SendStickerRequest request, Guid community, Guid channel, CancellationToken ct)
    {
        try { return StatusCode(201, await messages.SendAsync(community, channel, UserId, new(request.ClientMessageId, request.Content ?? "", request.ReplyToId, request.MentionUserIds), ct, stickerId: request.StickerId)); }
        catch (CommunityFailure e) { return Problem(statusCode: e.Status, title: e.Message); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }

    [HttpPost("attachments"), EnableRateLimiting("attachment-uploads")]
    [RequestSizeLimit(6 * 1024 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 6 * 1024 * 1024)]
    [ProducesResponseType<MessageDto>(201)]
    public async Task<ActionResult<MessageDto>> Send(Guid community, Guid channel, [FromForm] Guid clientMessageId, [FromForm] IFormFile file, [FromForm] string? content, [FromForm] Guid? replyToId, [FromForm] Guid[]? mentionUserIds, [FromForm] IFormFile? preview, CancellationToken ct)
    {
        try
        {
            var prepared = await ImagePreview.PrepareAsync(file, preview, ct);
            return StatusCode(201, await messages.SendAsync(community, channel, UserId, new(clientMessageId, content ?? "", replyToId, mentionUserIds), ct, prepared));
        }
        catch (CommunityFailure failure) { return Problem(statusCode: failure.Status, title: failure.Message); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }

    [HttpPost("voice-messages"), EnableRateLimiting("attachment-uploads")]
    [RequestSizeLimit(3 * 1024 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 3 * 1024 * 1024)]
    [ProducesResponseType<MessageDto>(201)]
    public async Task<ActionResult<MessageDto>> SendVoice(Guid community, Guid channel, [FromForm] Guid clientMessageId, [FromForm] IFormFile file, [FromForm] string? content, [FromForm] Guid? replyToId, [FromForm] Guid[]? mentionUserIds, CancellationToken ct)
    {
        try
        {
            var prepared = await AttachmentStore.PrepareVoiceAsync(file, ct);
            return StatusCode(201, await messages.SendAsync(community, channel, UserId, new(clientMessageId, content ?? "", replyToId, mentionUserIds), ct, prepared));
        }
        catch (CommunityFailure failure) { return Problem(statusCode: failure.Status, title: failure.Message); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }

    [HttpGet("attachments/{id:guid}")]
    public async Task<IActionResult> Download(Guid community, Guid channel, Guid id, [FromQuery] bool preview, CancellationToken ct)
    {
        try
        {
            await using var tx = await database.Database.BeginTransactionAsync(ct);
            await messages.LockAuthorizedAsync(community, channel, UserId, ct);
            var attachment = await database.MessageAttachments.AsNoTracking().SingleOrDefaultAsync(a => a.Id == id && a.Message.ChannelId == channel && !a.Message.Deleted && !a.Purged, ct);
            if (attachment is null) return Problem(statusCode: 404, title: "Attachment is unavailable.");
            if (preview && attachment.PreviewId is null) return Problem(statusCode: 404, title: "Image preview is unavailable. Load the original instead.");
            Stream stream;
            try { stream = files.Open(preview ? attachment.PreviewId!.Value : id); }
            catch (FileNotFoundException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
            Response.Headers.XContentTypeOptions = "nosniff";
            Response.Headers.ContentSecurityPolicy = "sandbox; default-src 'none'";
            try { await tx.CommitAsync(ct); }
            catch { await stream.DisposeAsync(); throw; }
            // Force download: no HTML/SVG/PDF or user-controlled MIME rendered on our origin.
            return File(stream, "application/octet-stream", preview ? "preview.image" : attachment.Name, enableRangeProcessing: false);
        }
        catch (CommunityFailure failure) { return Problem(statusCode: failure.Status, title: failure.Message); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }
}
