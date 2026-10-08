using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace App.Api.Features.Foundation;

public sealed record LivenessResponse(string Status);
public sealed record ReadinessResponse(string Status, Dictionary<string, string> Checks);

[ApiController]
[Route("health")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class HealthController(HealthCheckService healthChecks) : ControllerBase
{
    [HttpGet("live")]
    [ProducesResponseType<LivenessResponse>(StatusCodes.Status200OK)]
    public ActionResult<LivenessResponse> Live() => new LivenessResponse("healthy");

    [HttpGet("ready")]
    [ProducesResponseType<ReadinessResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ReadinessResponse>(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<ReadinessResponse>> Ready(CancellationToken cancellationToken)
    {
        var report = await healthChecks.CheckHealthAsync(
            registration => registration.Tags.Contains("ready"), cancellationToken);
        var response = new ReadinessResponse(
            report.Status == HealthStatus.Healthy ? "healthy" : "unhealthy",
            report.Entries.ToDictionary(entry => entry.Key,
                entry => entry.Value.Status == HealthStatus.Healthy ? "healthy" : "unhealthy"));
        return StatusCode(report.Status == HealthStatus.Healthy
            ? StatusCodes.Status200OK
            : StatusCodes.Status503ServiceUnavailable, response);
    }
}
