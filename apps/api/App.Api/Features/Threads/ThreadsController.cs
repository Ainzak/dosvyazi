using System.Security.Claims;
using App.Api.Features.Communities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
namespace App.Api.Features.Threads;

[ApiController, Authorize, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/v1/communities/{community:guid}/channels/{parent:guid}/threads")]
public sealed class ThreadsController(ThreadService threads) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private async Task<ActionResult<T>> Execute<T>(Func<Task<T>> action, int status = 200)
    {
        try { return StatusCode(status, await action()); }
        catch (CommunityFailure failure) { return Problem(statusCode: failure.Status, title: failure.Message); }
    }
    [HttpGet]
    public Task<ActionResult<ThreadPage>> List(Guid community, Guid parent, [FromQuery] string? before, [FromQuery] string? roots, [FromQuery] bool archived, [FromQuery] string? query, CancellationToken ct) => Execute(() => threads.List(community, parent, UserId, before, roots, archived, query, ct));
    [HttpGet("{thread:guid}")]
    public Task<ActionResult<ThreadDto>> Get(Guid community, Guid parent, Guid thread, CancellationToken ct) => Execute(() => threads.Get(community, parent, thread, UserId, ct));
    [HttpPost, EnableRateLimiting("community-commands"), RequestSizeLimit(4096)]
    public Task<ActionResult<ThreadDto>> Create(Guid community, Guid parent, CreateThreadRequest request, CancellationToken ct) => Execute(() => threads.Create(community, parent, UserId, request, ct), 201);
    [HttpPut("{thread:guid}"), EnableRateLimiting("community-commands"), RequestSizeLimit(4096)]
    public Task<ActionResult<ThreadDto>> Change(Guid community, Guid parent, Guid thread, ChangeThreadRequest request, CancellationToken ct) => Execute(() => threads.Change(community, parent, thread, UserId, request, ct));
}
