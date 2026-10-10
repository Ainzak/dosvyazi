using App.Api.Features.Communities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace App.Api.Features.Voice;

[ApiController, Authorize, Route("api/v1/communities/{id:guid}/voice")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class VoiceController(VoiceService voice) : ControllerBase
{
    private async Task<ActionResult<T>> Execute<T>(Func<Task<T>> action)
    {
        try { return Ok(await action()); }
        catch (CommunityFailure error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (VoiceGatewayException) { return Problem(statusCode: 503, title: "Voice service is unavailable. Try again shortly."); }
    }
    [HttpGet]
    public Task<ActionResult<VoiceStateDto>> State(Guid id, CancellationToken ct) => Execute(() => voice.StateAsync(id, User, ct));
    [HttpPost("join"), EnableRateLimiting("voice-joins")]
    public Task<ActionResult<VoiceJoinDto>> Join(Guid id, JoinVoiceRequest request, CancellationToken ct) => Execute(() => voice.JoinAsync(id, request, User, ct));
    [HttpPost("leave"), EnableRateLimiting("community-commands")]
    public Task<ActionResult<VoiceStateDto>> Leave(Guid id, VoiceLeaseRequest request, CancellationToken ct) => Execute(() => voice.LeaveAsync(id, request, User, ct));
    [HttpPost("heartbeat"), EnableRateLimiting("community-commands")]
    public Task<ActionResult<bool>> Heartbeat(Guid id, VoiceLeaseRequest request, CancellationToken ct) => Execute(() => voice.HeartbeatAsync(id, request, User, ct));
    [HttpPost("disconnect"), EnableRateLimiting("community-commands")]
    public Task<ActionResult<bool>> Disconnect(Guid id, VoiceLeaseRequest request, CancellationToken ct) => Execute(() => voice.DisconnectAsync(id, request, User, ct));
}
