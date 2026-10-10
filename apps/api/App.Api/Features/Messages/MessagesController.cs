using System.Security.Claims;
using App.Api.Features.Communities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace App.Api.Features.Messages;

[ApiController, Authorize, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/v1/communities/{community:guid}/channels/{channel:guid}")]
public sealed class MessagesController(MessageService messages) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private async Task<ActionResult<T>> Execute<T>(Func<Task<T>> action, int status = 200)
    {
        try { return StatusCode(status, await action()); }
        catch (CommunityFailure failure) { return Problem(statusCode: failure.Status, title: failure.Message); }
    }

    [HttpGet("messages")]
    public Task<ActionResult<MessageSnapshot>> History(Guid community, Guid channel, [FromQuery] string? before, CancellationToken ct)
        => Execute(() => messages.HistoryAsync(community, channel, UserId, before, ct));

    [HttpPost("messages"), EnableRateLimiting("community-commands")]
    [ProducesResponseType<MessageDto>(201)]
    public Task<ActionResult<MessageDto>> Send(Guid community, Guid channel, SendMessageRequest request, CancellationToken ct)
        => Execute(() => messages.SendAsync(community, channel, UserId, request, ct), 201);

    [HttpGet("events")]
    public Task<ActionResult<CatchUpPage>> Events(Guid community, Guid channel, [FromQuery] string after, CancellationToken ct)
        => Execute(() => messages.CatchUpAsync(community, channel, UserId, after, ct));

    [HttpPut("messages/{id:guid}"), EnableRateLimiting("community-commands")]
    public Task<ActionResult<MessageCommandResult>> Edit(Guid community, Guid channel, Guid id, EditMessageRequest request, CancellationToken ct) => Execute(() => messages.EditAsync(community, channel, UserId, id, request, ct));

    [HttpPost("messages/{id:guid}/delete"), EnableRateLimiting("community-commands")]
    public Task<ActionResult<MessageCommandResult>> Delete(Guid community, Guid channel, Guid id, DeleteMessageRequest request, CancellationToken ct) => Execute(() => messages.DeleteAsync(community, channel, UserId, id, request, ct));
}
