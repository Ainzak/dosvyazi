using System.Security.Claims;
using App.Api.Features.Communities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
namespace App.Api.Features.Forums;

[ApiController, Authorize, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/v1/communities/{community:guid}/forums/{forum:guid}/topics")]
public sealed class ForumsController(ForumService forums) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private async Task<ActionResult<T>> Execute<T>(Func<Task<T>> action, int status = 200)
    {
        try { return StatusCode(status, await action()); }
        catch (CommunityFailure failure) { return Problem(statusCode: failure.Status, title: failure.Message); }
    }
    [HttpGet]
    public Task<ActionResult<ForumTopicPage>> List(Guid community, Guid forum, [FromQuery] string? before, [FromQuery] bool archived, [FromQuery] string? query, CancellationToken ct) => Execute(() => forums.List(community, forum, UserId, before, archived, query, ct));
    [HttpGet("{topic:guid}")]
    public Task<ActionResult<ForumTopicDto>> Get(Guid community, Guid forum, Guid topic, CancellationToken ct) => Execute(() => forums.Get(community, forum, topic, UserId, ct));
    [HttpPost, EnableRateLimiting("community-commands"), RequestSizeLimit(24576)]
    public Task<ActionResult<ForumTopicDto>> Create(Guid community, Guid forum, CreateForumTopicRequest request, CancellationToken ct) => Execute(() => forums.Create(community, forum, UserId, request, ct), 201);
    [HttpPut("{topic:guid}"), EnableRateLimiting("community-commands"), RequestSizeLimit(4096)]
    public Task<ActionResult<ForumTopicDto>> Change(Guid community, Guid forum, Guid topic, ChangeForumTopicRequest request, CancellationToken ct) => Execute(() => forums.Change(community, forum, topic, UserId, request, ct));
}
