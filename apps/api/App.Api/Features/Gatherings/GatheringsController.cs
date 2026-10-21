using System.Security.Claims;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Gatherings;
[ApiController, Authorize, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/v1/communities/{community:guid}/gatherings")]
public sealed class GatheringsController(GatheringService gatherings, AppDbContext db, AttachmentStore files) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private async Task<ActionResult<T>> Execute<T>(Func<Task<T>> action)
    { try { return Ok(await action()); } catch (CommunityFailure e) { return Problem(statusCode: e.Status, title: e.Message); } }
    [HttpGet] public Task<ActionResult<GatheringList>> List(Guid community, [FromQuery] int offset, CancellationToken ct) => Execute(() => gatherings.List(community, UserId, offset, ct));
    [HttpGet("candidates")] public Task<ActionResult<GatheringCandidates>> Candidates(Guid community, [FromQuery] int offset, CancellationToken ct) => Execute(() => gatherings.Candidates(community, UserId, offset, ct));
    [HttpGet("notices")] public Task<ActionResult<GatheringNotices>> Notices(Guid community, [FromQuery] int offset, CancellationToken ct) => Execute(() => gatherings.Notices(community, UserId, offset, ct));
    [HttpPost("notices/{id:guid}/seen"), EnableRateLimiting("community-commands")]
    public async Task<IActionResult> Seen(Guid community, Guid id, CancellationToken ct)
    { try { await gatherings.Seen(community, id, UserId, ct); return NoContent(); } catch (CommunityFailure e) { return Problem(statusCode: e.Status, title: e.Message); } }
    [HttpGet("{id:guid}")] public Task<ActionResult<GatheringDto>> Get(Guid community, Guid id, CancellationToken ct) => Execute(() => gatherings.Get(community, id, UserId, ct));
    [HttpGet("{id:guid}/preparation")]
    public Task<ActionResult<GatheringPreparationDto>> Preparation(Guid community, Guid id, CancellationToken ct) => Execute(() => gatherings.Preparation(community, id, UserId, ct));
    [HttpGet("{id:guid}/choices")]
    public Task<ActionResult<GatheringChoicesDto>> Choices(Guid community, Guid id, CancellationToken ct) => Execute(() => gatherings.Choices(community, id, UserId, ct));
    [HttpPut("{id:guid}/capacity"), EnableRateLimiting("community-commands"), RequestSizeLimit(1024)]
    public Task<ActionResult<GatheringDto>> Capacity(Guid community, Guid id, CapacityRequest r, CancellationToken ct) => Execute(() => gatherings.Capacity(community, id, UserId, r, ct));
    [HttpPut("{id:guid}/seat"), EnableRateLimiting("community-commands"), RequestSizeLimit(1024)]
    public Task<ActionResult<GatheringDto>> Seat(Guid community, Guid id, SeatRequest r, CancellationToken ct) => Execute(() => gatherings.Seat(community, id, UserId, r, ct));
    [HttpPost("{id:guid}/polls"), EnableRateLimiting("community-commands"), RequestSizeLimit(8192)]
    public Task<ActionResult<GatheringChoicesDto>> Poll(Guid community, Guid id, PollCreateRequest r, CancellationToken ct) => Execute(() => gatherings.CreatePoll(community, id, UserId, r, ct));
    [HttpPut("{id:guid}/polls/{poll:guid}/vote"), EnableRateLimiting("community-commands"), RequestSizeLimit(2048)]
    public Task<ActionResult<GatheringChoicesDto>> Vote(Guid community, Guid id, Guid poll, PollVoteRequest r, CancellationToken ct) => Execute(() => gatherings.Vote(community, id, poll, UserId, r, ct));
    [HttpPut("{id:guid}/polls/{poll:guid}/decision"), EnableRateLimiting("community-commands"), RequestSizeLimit(1024)]
    public Task<ActionResult<GatheringChoicesDto>> Decide(Guid community, Guid id, Guid poll, PollDecisionRequest r, CancellationToken ct) => Execute(() => gatherings.DecidePoll(community, id, poll, UserId, r, ct));
    [HttpPut("{id:guid}/checklist/{item:guid}"), EnableRateLimiting("community-commands"), RequestSizeLimit(4096)]
    public Task<ActionResult<GatheringPreparationDto>> Checklist(Guid community, Guid id, Guid item, ChecklistRequest r, CancellationToken ct) => Execute(() => gatherings.Checklist(community, id, item, UserId, r, ct));
    [HttpPut("{id:guid}/reminder"), EnableRateLimiting("community-commands"), RequestSizeLimit(1024)]
    public Task<ActionResult<GatheringPreparationDto>> Reminder(Guid community, Guid id, ReminderRequest r, CancellationToken ct) => Execute(() => gatherings.Reminder(community, id, UserId, r, ct));
    [HttpGet("{id:guid}/calendar")]
    public async Task<IActionResult> Calendar(Guid community, Guid id, CancellationToken ct)
    {
        try {
            var content = await gatherings.Calendar(community, id, UserId, ct);
            Response.Headers.XContentTypeOptions = "nosniff"; Response.Headers.ContentSecurityPolicy = "sandbox; default-src 'none'";
            return File(System.Text.Encoding.UTF8.GetBytes(content), "text/calendar; charset=utf-8", "gathering.ics");
        } catch (CommunityFailure e) { return Problem(statusCode: e.Status, title: e.Message); }
    }
    [HttpGet("{id:guid}/revisions")] public Task<ActionResult<GatheringRevisionDto[]>> Revisions(Guid community, Guid id, CancellationToken ct) => Execute(() => gatherings.Revisions(community, id, UserId, ct));
    [HttpPost, EnableRateLimiting("community-commands"), RequestSizeLimit(32 * 1024)]
    public Task<ActionResult<GatheringDto>> Create(Guid community, GatheringPlanRequest r, CancellationToken ct) => Execute(() => gatherings.Create(community, UserId, r, ct));
    [HttpPut("{id:guid}"), EnableRateLimiting("community-commands"), RequestSizeLimit(32 * 1024)]
    public Task<ActionResult<GatheringDto>> Edit(Guid community, Guid id, GatheringPlanRequest r, CancellationToken ct) => Execute(() => gatherings.Edit(community, id, UserId, r, ct));
    [HttpPut("{id:guid}/response"), EnableRateLimiting("community-commands"), RequestSizeLimit(16 * 1024)]
    public Task<ActionResult<GatheringDto>> Respond(Guid community, Guid id, GatheringResponseRequest r, CancellationToken ct) => Execute(() => gatherings.Respond(community, id, UserId, r, ct));
    [HttpPost("{id:guid}/comments"), EnableRateLimiting("community-commands"), RequestSizeLimit(16 * 1024)]
    public Task<ActionResult<GatheringDto>> Discuss(Guid community, Guid id, GatheringCommentRequest r, CancellationToken ct) => Execute(() => gatherings.Discuss(community, id, UserId, r, ct));
    [HttpPut("{id:guid}/status"), EnableRateLimiting("community-commands"), RequestSizeLimit(1024)]
    public Task<ActionResult<GatheringDto>> Status(Guid community, Guid id, GatheringStatusRequest r, CancellationToken ct) => Execute(() => gatherings.Status(community, id, UserId, r, ct));
    [HttpPost("{id:guid}/cover"), EnableRateLimiting("attachment-uploads"), RequestSizeLimit(3 * 1024 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 3 * 1024 * 1024)]
    public async Task<ActionResult<GatheringDto>> Cover(Guid community, Guid id, [FromForm] Guid clientRequestId, [FromForm] string expectedVersion, [FromForm] IFormFile file, CancellationToken ct)
    {
        try { var prepared = await AttachmentStore.PrepareAsync(file, ct); return Ok(await gatherings.Cover(community, id, UserId, new(clientRequestId, expectedVersion), prepared, files, ct)); }
        catch (CommunityFailure e) { return Problem(statusCode: e.Status, title: e.Message); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }
    [HttpPost("{id:guid}/cover/remove"), EnableRateLimiting("community-commands"), RequestSizeLimit(1024)]
    public Task<ActionResult<GatheringDto>> RemoveCover(Guid community, Guid id, GatheringCoverRequest r, CancellationToken ct) => Execute(() => gatherings.Cover(community, id, UserId, r, null, files, ct));
    [HttpGet("{id:guid}/cover/{cover:guid}")]
    public async Task<IActionResult> Image(Guid community, Guid id, Guid cover, CancellationToken ct)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await gatherings.Authorized(community, id, UserId, ct);
            var image = await db.GatheringCovers.AsNoTracking().SingleOrDefaultAsync(c => c.Id == cover && c.GatheringId == id && !c.Retired && !c.Purged, ct);
            if (g.CoverId != cover || image is null) throw new CommunityFailure(404, "Gathering cover is unavailable.");
            var stream = files.Open(cover); try { await tx.CommitAsync(ct); } catch { await stream.DisposeAsync(); throw; }
            Response.Headers.XContentTypeOptions = "nosniff"; Response.Headers.ContentSecurityPolicy = "sandbox; default-src 'none'";
            return File(stream, image.ContentType);
        }
        catch (CommunityFailure e) { return Problem(statusCode: e.Status, title: e.Message); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }
}
