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

    [HttpPost("attachments"), EnableRateLimiting("attachment-uploads")]
    [RequestSizeLimit(6 * 1024 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 6 * 1024 * 1024)]
    [ProducesResponseType<MessageDto>(201)]
    public async Task<ActionResult<MessageDto>> Send(Guid community, Guid channel, [FromForm] Guid clientMessageId, [FromForm] IFormFile file, [FromForm] string? content, CancellationToken ct)
    {
        try
        {
            var prepared = await AttachmentStore.PrepareAsync(file, ct);
            return StatusCode(201, await messages.SendAsync(community, channel, UserId, new(clientMessageId, content ?? ""), ct, prepared));
        }
        catch (CommunityFailure failure) { return Problem(statusCode: failure.Status, title: failure.Message); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }

    [HttpGet("attachments/{id:guid}")]
    public async Task<IActionResult> Download(Guid community, Guid channel, Guid id, CancellationToken ct)
    {
        try
        {
            await using var tx = await database.Database.BeginTransactionAsync(ct);
            await messages.LockAuthorizedAsync(community, channel, UserId, ct);
            var attachment = await database.MessageAttachments.AsNoTracking().SingleOrDefaultAsync(a => a.Id == id && a.Message.ChannelId == channel && !a.Message.Deleted && !a.Purged, ct);
            if (attachment is null) return Problem(statusCode: 404, title: "Attachment is unavailable.");
            Stream stream;
            try { stream = files.Open(id); }
            catch (FileNotFoundException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
            Response.Headers.XContentTypeOptions = "nosniff";
            Response.Headers.ContentSecurityPolicy = "sandbox; default-src 'none'";
            try { await tx.CommitAsync(ct); }
            catch { await stream.DisposeAsync(); throw; }
            // Force download: no HTML/SVG/PDF or user-controlled MIME rendered on our origin.
            return File(stream, "application/octet-stream", attachment.Name, enableRangeProcessing: false);
        }
        catch (CommunityFailure failure) { return Problem(statusCode: failure.Status, title: failure.Message); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }
}
