using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace App.Api.Features.Communities;

[ApiController, Authorize, Route("api/v1/communities")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AdministrationController(AdministrationService administration) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private async Task<ActionResult<T>> Execute<T>(Func<Task<T>> action, int success = 200)
    {
        try { return StatusCode(success, await action()); }
        catch (CommunityFailure failure) { return Problem(statusCode: failure.Status, title: failure.Message); }
    }
    [HttpGet("{id:guid}/rights")]
    public Task<ActionResult<RightsExplanation>> Rights(Guid id, [FromQuery] string kind, [FromQuery] Guid? channelId, [FromQuery] Guid? userId, CancellationToken ct) => Execute(() => administration.Explain(id, UserId, kind, channelId, userId, ct));

    [HttpGet("{id:guid}/configuration")]
    public Task<ActionResult<CommunityConfiguration>> Export(Guid id, CancellationToken ct) => Execute(() => administration.Export(id, UserId, ct));

    [HttpPost("configuration/preview"), EnableRateLimiting("community-commands"), RequestSizeLimit(256 * 1024)]
    public ActionResult<CommunityConfiguration> Preview(ConfigurationPreviewRequest request)
    {
        try { return Ok(AdministrationService.Validate(request.Configuration)); }
        catch (CommunityFailure failure) { return Problem(statusCode: failure.Status, title: failure.Message); }
    }

    [HttpPost("configuration/restore"), EnableRateLimiting("community-commands"), RequestSizeLimit(256 * 1024)]
    public Task<ActionResult<ConfigurationRestored>> Restore(ConfigurationRestoreRequest request, CancellationToken ct) => Execute(() => administration.Restore(UserId, request, ct), 201);
}
