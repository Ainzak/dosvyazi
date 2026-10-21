using App.Api.Features.Communities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace App.Api.Features.Navigation;

[ApiController, Authorize, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/v1/navigation")]
public sealed class NavigationController(NavigationService service) : ControllerBase
{
    private async Task<ActionResult<T>> Execute<T>(Func<Task<T>> action)
    {
        try { return Ok(await action()); }
        catch (CommunityFailure e) { return Problem(statusCode: e.Status, title: e.Message); }
    }
    [HttpGet("{kind}/{container:guid}/messages/{message:guid}")]
    public Task<ActionResult<SourceDto>> Source(string kind, Guid container, Guid message, CancellationToken ct) => Execute(() => service.SourceAsync(kind, container, message, User, ct));
    [HttpGet("{kind}/{container:guid}/members")]
    public Task<ActionResult<MentionMember[]>> Members(string kind, Guid container, [FromQuery] string? query, CancellationToken ct) => Execute(() => service.MembersAsync(kind, container, query, User, ct));
    [HttpGet("{kind}/{container:guid}/preference")]
    public Task<ActionResult<PreferenceDto>> Preference(string kind, Guid container, CancellationToken ct) => Execute(() => service.PreferenceAsync(kind, container, User, null, ct));
    [HttpPut("{kind}/{container:guid}/preference"), EnableRateLimiting("community-commands"), RequestSizeLimit(4096)]
    public Task<ActionResult<PreferenceDto>> SetPreference(string kind, Guid container, PreferenceRequest request, CancellationToken ct) => Execute(() => service.PreferenceAsync(kind, container, User, request, ct));
    [HttpPut("bookmarks"), EnableRateLimiting("community-commands"), RequestSizeLimit(8192)]
    public Task<ActionResult<bool>> Bookmark(BookmarkRequest request, CancellationToken ct) => Execute(() => service.BookmarkAsync(request, User, ct));
    [HttpGet("bookmarks")]
    public Task<ActionResult<BookmarkPage>> Bookmarks([FromQuery] Guid? before, [FromQuery] string? tag, [FromQuery] string? query, CancellationToken ct) => Execute(() => service.BookmarksAsync(User, before, tag, query, ct));
    [HttpGet("{kind}/{container:guid}/bookmarks/{message:guid}")]
    public Task<ActionResult<BookmarkDto?>> BookmarkInfo(string kind, Guid container, Guid message, CancellationToken ct) => Execute(() => service.BookmarkInfoAsync(kind, container, message, User, ct));
    [HttpGet("notices")]
    public Task<ActionResult<NoticePage>> Notices([FromQuery] Guid? before, CancellationToken ct) => Execute(() => service.NoticesAsync(User, before, ct));
    [HttpPut("notices/{id:guid}"), EnableRateLimiting("community-commands"), RequestSizeLimit(4096)]
    public Task<ActionResult<bool>> ReadNotice(Guid id, NoticeReadRequest request, CancellationToken ct) => Execute(() => service.ReadNoticeAsync(id, request, User, ct));
}
