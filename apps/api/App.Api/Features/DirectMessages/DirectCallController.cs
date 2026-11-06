using App.Api.Features.Communities;
using App.Api.Features.Voice;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace App.Api.Features.DirectMessages;

[ApiController, Authorize, Route("api/v1/direct-calls")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class DirectCallController(DirectCallService calls) : ControllerBase
{
    private async Task<ActionResult<T>> Execute<T>(Func<Task<T>> action)
    {
        try { return Ok(await action()); }
        catch (CommunityFailure error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (VoiceGatewayException) { return Problem(statusCode: 503, title: "Voice service is unavailable."); }
    }
    [HttpGet, EnableRateLimiting("call-reads")]
    public Task<ActionResult<DirectCallDto[]>> Current(CancellationToken ct) => Execute(() => calls.CurrentAsync(User, ct));
    [HttpPost("conversation/{conversation:guid}"), EnableRateLimiting("direct-starts")]
    public Task<ActionResult<DirectCallDto>> Start(Guid conversation, StartCallRequest request, CancellationToken ct) => Execute(() => calls.StartAsync(conversation, request, User, ct));
    [HttpGet("{id:guid}"), EnableRateLimiting("call-reads")]
    public Task<ActionResult<DirectCallDto>> Get(Guid id, CancellationToken ct) => Execute(() => calls.GetAsync(id, User, ct));
    [HttpPost("{id:guid}/accept"), EnableRateLimiting("direct-commands")]
    public Task<ActionResult<DirectCallDto>> Accept(Guid id, CancellationToken ct) => Execute(() => calls.AcceptAsync(id, User, ct));
    [HttpPost("{id:guid}/end"), EnableRateLimiting("direct-commands")]
    public Task<ActionResult<DirectCallDto>> End(Guid id, CancellationToken ct) => Execute(() => calls.EndAsync(id, User, ct));
    [HttpPost("{id:guid}/join"), EnableRateLimiting("voice-joins")]
    public Task<ActionResult<VoiceJoinDto>> Join(Guid id, JoinVoiceRequest request, CancellationToken ct) => Execute(() => calls.JoinAsync(id, request, User, ct));
    [HttpPost("{id:guid}/heartbeat"), EnableRateLimiting("direct-commands")]
    public Task<ActionResult<bool>> Heartbeat(Guid id, VoiceLeaseRequest request, CancellationToken ct) => Execute(() => calls.HeartbeatAsync(id, request, User, ct));
    [HttpGet("{id:guid}/state"), EnableRateLimiting("call-reads")]
    public Task<ActionResult<VoiceStateDto>> State(Guid id, CancellationToken ct) => Execute(() => calls.StateAsync(id, User, ct));
}
