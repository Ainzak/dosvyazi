using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace App.Api.Features.Communities;

[ApiController, Authorize]
[Route("api/v1/communities")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class CommunitiesController(CommunityService communities) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private async Task<ActionResult<T>> Execute<T>(Func<Task<T>> action, int success = 200)
    {
        try { return StatusCode(success, await action()); }
        catch (CommunityFailure failure) { return Problem(statusCode: failure.Status, title: failure.Message); }
    }

    [HttpGet]
    public Task<ActionResult<CommunitySummary[]>> List(CancellationToken ct) => Execute(() => communities.ListAsync(UserId, ct));

    [HttpPost, EnableRateLimiting("community-commands")]
    [ProducesResponseType<CommunityDetails>(201)]
    public Task<ActionResult<CommunityDetails>> Create(CreateCommunityRequest request, CancellationToken ct) => Execute(() => communities.CreateAsync(request, UserId, ct), 201);

    [HttpGet("{id:guid}")]
    public Task<ActionResult<CommunityDetails>> Get(Guid id, CancellationToken ct) => Execute(() => communities.GetAsync(id, UserId, ct));

    [HttpGet("{id:guid}/channels/{channelId:guid}")]
    public Task<ActionResult<ChannelSummary>> Channel(Guid id, Guid channelId, CancellationToken ct) => Execute(() => communities.ChannelAsync(id, channelId, UserId, ct));

    [HttpPost("{id:guid}/invites"), EnableRateLimiting("community-commands")]
    [ProducesResponseType<CreatedInvite>(201)]
    public Task<ActionResult<CreatedInvite>> Invite(Guid id, CreateInviteRequest request, CancellationToken ct) => Execute(() => communities.CreateInviteAsync(id, request, UserId, ct), 201);

    [HttpGet("{id:guid}/invites")]
    public Task<ActionResult<InviteSummary[]>> Invites(Guid id, CancellationToken ct) => Execute(() => communities.InvitesAsync(id, UserId, ct));

    [HttpPost("{id:guid}/invites/{inviteId:guid}/revoke"), EnableRateLimiting("community-commands")]
    public Task<ActionResult<InviteSummary>> Revoke(Guid id, Guid inviteId, CancellationToken ct) => Execute(() => communities.RevokeInviteAsync(id, inviteId, UserId, ct));

    [HttpPost("join"), EnableRateLimiting("community-commands")]
    public Task<ActionResult<CommunityDetails>> Join(AcceptInviteRequest request, CancellationToken ct) => Execute(() => communities.AcceptAsync(request.Code, UserId, ct));

    [HttpGet("{id:guid}/members")]
    public Task<ActionResult<MemberSummary[]>> Members(Guid id, CancellationToken ct) => Execute(() => communities.MembersAsync(id, UserId, ct));

    [HttpPut("{id:guid}/members/{memberId:guid}/ban"), EnableRateLimiting("community-commands")]
    public Task<ActionResult<MemberSummary>> Ban(Guid id, Guid memberId, BanMemberRequest request, CancellationToken ct) => Execute(() => communities.BanAsync(id, memberId, request.Banned, UserId, ct));

    [HttpPost("{id:guid}/leave"), EnableRateLimiting("community-commands")]
    public Task<ActionResult<bool>> Leave(Guid id, CancellationToken ct) => Execute(() => communities.LeaveAsync(id, UserId, ct));
}
