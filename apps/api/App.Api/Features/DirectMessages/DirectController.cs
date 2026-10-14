using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.DirectMessages;

[ApiController, Authorize, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/v1/direct-messages")]
public sealed class DirectController(DirectService service, AppDbContext db, AttachmentStore files) : ControllerBase
{
    private async Task<ActionResult<T>> Execute<T>(Func<Task<T>> action, int status = 200)
    {
        try { return StatusCode(status, await action()); }
        catch (CommunityFailure error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }
    [HttpGet]
    public Task<ActionResult<DirectInbox>> Inbox([FromQuery] Guid? before, CancellationToken ct) => Execute(() => service.InboxAsync(User, before, ct));
    [HttpPost, EnableRateLimiting("direct-starts"), RequestSizeLimit(4096)]
    public Task<ActionResult<DirectConversationDto>> Start(StartDirectRequest request, CancellationToken ct) => Execute(() => service.StartAsync(request, User, ct), 201);
    [HttpGet("{conversation:guid}")]
    public Task<ActionResult<DirectConversationDto>> Get(Guid conversation, CancellationToken ct) => Execute(() => service.GetAsync(conversation, User, ct));
    [HttpGet("{conversation:guid}/messages")]
    public Task<ActionResult<DirectSnapshot>> History(Guid conversation, [FromQuery] string? before, CancellationToken ct) => Execute(() => service.HistoryAsync(conversation, User, before, ct));
    [HttpGet("{conversation:guid}/events")]
    public Task<ActionResult<DirectCatchUp>> Events(Guid conversation, [FromQuery] string after, CancellationToken ct) => Execute(() => service.EventsAsync(conversation, User, after, ct));
    [HttpPost("{conversation:guid}/messages"), EnableRateLimiting("direct-commands"), RequestSizeLimit(32768)]
    public Task<ActionResult<DirectMessageDto>> Send(Guid conversation, SendMessageRequest request, CancellationToken ct) => Execute(() => service.SendAsync(conversation, request, User, null, ct), 201);
    [HttpPut("{conversation:guid}/messages/{message:guid}"), EnableRateLimiting("direct-commands"), RequestSizeLimit(32768)]
    public Task<ActionResult<DirectMessageDto>> Edit(Guid conversation, Guid message, EditMessageRequest request, CancellationToken ct) => Execute(() => service.ChangeAsync(conversation, message, request.ClientRequestId, request.ExpectedVersion, request.Content, User, ct));
    [HttpPost("{conversation:guid}/messages/{message:guid}/delete"), EnableRateLimiting("direct-commands"), RequestSizeLimit(4096)]
    public Task<ActionResult<DirectMessageDto>> Delete(Guid conversation, Guid message, DeleteDirectRequest request, CancellationToken ct) => Execute(() => service.ChangeAsync(conversation, message, request.ClientRequestId, request.ExpectedVersion, null, User, ct));
    [HttpPut("{conversation:guid}/read"), EnableRateLimiting("direct-reads"), RequestSizeLimit(4096)]
    public Task<ActionResult<DirectConversationDto>> Read(Guid conversation, DirectReadRequest request, CancellationToken ct) => Execute(() => service.ReadAsync(conversation, request, User, ct));
    [HttpPut("{conversation:guid}/block"), EnableRateLimiting("direct-commands"), RequestSizeLimit(4096)]
    public Task<ActionResult<DirectConversationDto>> Block(Guid conversation, BlockDirectRequest request, CancellationToken ct) => Execute(() => service.BlockAsync(conversation, request, User, ct));
    [HttpPost("{conversation:guid}/attachments"), EnableRateLimiting("attachment-uploads")]
    [RequestSizeLimit(6 * 1024 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 6 * 1024 * 1024)]
    public Task<ActionResult<DirectMessageDto>> Attachment(Guid conversation, [FromForm] Guid clientMessageId, [FromForm] string? content, [FromForm] IFormFile file, CancellationToken ct)
        => Execute(async () => await service.SendAsync(conversation, new(clientMessageId, content ?? ""), User, await AttachmentStore.PrepareAsync(file, ct), ct), 201);
    [HttpPost("{conversation:guid}/voice-messages"), EnableRateLimiting("attachment-uploads")]
    [RequestSizeLimit(3 * 1024 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 3 * 1024 * 1024)]
    public Task<ActionResult<DirectMessageDto>> Voice(Guid conversation, [FromForm] Guid clientMessageId, [FromForm] string? content, [FromForm] IFormFile file, CancellationToken ct)
        => Execute(async () => await service.SendAsync(conversation, new(clientMessageId, content ?? ""), User, await AttachmentStore.PrepareVoiceAsync(file, ct), ct), 201);
    [HttpGet("{conversation:guid}/attachments/{attachment:guid}")]
    public async Task<IActionResult> Download(Guid conversation, Guid attachment, CancellationToken ct)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct); await service.LockAsync(conversation, User, ct);
            var item = await db.DirectAttachments.AsNoTracking().SingleOrDefaultAsync(a => a.Id == attachment && a.Message.ConversationId == conversation && !a.Message.Deleted && !a.Purged, ct);
            if (item is null) return Problem(statusCode: 404, title: "Attachment is unavailable.");
            var stream = files.Open(item.Id); Response.Headers.XContentTypeOptions = "nosniff"; Response.Headers.ContentSecurityPolicy = "sandbox; default-src 'none'";
            try { await tx.CommitAsync(ct); } catch { await stream.DisposeAsync(); throw; }
            return File(stream, "application/octet-stream", item.Name, enableRangeProcessing: false);
        }
        catch (CommunityFailure error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }
}
