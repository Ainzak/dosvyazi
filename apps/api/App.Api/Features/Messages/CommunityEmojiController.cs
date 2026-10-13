using System.Buffers.Binary;
using System.Security.Claims;
using System.Text.RegularExpressions;
using App.Api.Features.Communities;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Messages;
[ApiController, Authorize, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/v1/communities/{community:guid}/emoji")]
public sealed class CommunityEmojiController(AppDbContext db, AttachmentStore files) : ControllerBase
{
    private async Task Guard(Guid community, bool manage, CancellationToken ct)
    {
        var user = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        if (!await db.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(ct) ||
            !await db.Memberships.AnyAsync(m => m.CommunityId == community && m.UserId == user && m.Status == "Active", ct)) throw new CommunityFailure(404, "Community is unavailable.");
        if (manage && ((await ChannelAccess.BaseAsync(db, community, user, ct)).Permissions & ChannelAccess.ManageRoles) == 0) throw new CommunityFailure(403, "ManageRoles is required to manage custom emoji.");
    }
    [HttpGet]
    public async Task<ActionResult<EmojiDto[]>> List(Guid community, CancellationToken ct)
    {
        try { await using var tx = await db.Database.BeginTransactionAsync(ct); await Guard(community, false, ct);
            var result = await db.CommunityEmojis.AsNoTracking().Where(e => e.CommunityId == community && !e.Deleted).OrderBy(e => e.Name).Select(e => new EmojiDto(e.Id.ToString(), e.Name)).ToArrayAsync(ct);
            await tx.CommitAsync(ct); return Ok(result); }
        catch (CommunityFailure e) { return Problem(statusCode: e.Status, title: e.Message); }
    }
    [HttpPost, EnableRateLimiting("attachment-uploads"), RequestSizeLimit(300 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 300 * 1024)]
    public async Task<ActionResult<EmojiDto>> Create(Guid community, [FromForm] Guid clientRequestId, [FromForm] string name, [FromForm] IFormFile file, CancellationToken ct)
    {
        try
        {
            if (clientRequestId == Guid.Empty || !Regex.IsMatch(name, "^[a-z0-9_]{2,32}$")) throw new CommunityFailure(422, "Use an emoji name of 2–32 lowercase letters, digits or underscores.");
            var prepared = await AttachmentStore.PrepareAsync(file, ct); var b = prepared.Bytes;
            if (b.Length is < 33 or > 262144 || !b.AsSpan().StartsWith(new byte[] {137,80,78,71,13,10,26,10}) || !b.AsSpan(12,4).SequenceEqual("IHDR"u8) ||
                BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(16,4)) is < 1 or > 256 || BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(20,4)) is < 1 or > 256)
                throw new CommunityFailure(422, "Custom emoji must be PNG, up to 256 KiB and 256 by 256 pixels.");
            await using var tx = await db.Database.BeginTransactionAsync(ct); await Guard(community, true, ct);
            var item = await db.CommunityEmojis.SingleOrDefaultAsync(e => e.CommunityId == community && e.ClientRequestId == clientRequestId, ct);
            if (item is not null) { if (item.Name != name || item.Hash != prepared.Hash || item.Deleted) throw new CommunityFailure(409, "Emoji request changed or was removed."); }
            else
            {
                // Retire names too: reusing an alias must not replace artwork in old messages.
                if (await db.CommunityEmojis.CountAsync(e => e.CommunityId == community && !e.Deleted, ct) >= 32 || await db.CommunityEmojis.AnyAsync(e => e.CommunityId == community && e.Name == name, ct)) throw new CommunityFailure(409, "Emoji name already exists or the community has 32 emoji.");
                await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(73421891)", ct);
                if (files.UsedBytes() + b.Length > files.QuotaBytes) throw new CommunityFailure(409, "Attachment storage is full. Ask the operator to free space.");
                item = new() { Id = Guid.NewGuid(), CommunityId = community, ClientRequestId = clientRequestId, Name = name, Hash = prepared.Hash };
                await files.WriteAsync(item.Id, b, ct); db.CommunityEmojis.Add(item);
                CommunityAudit.Add(db, community, Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!), "emoji.created", item.Id);
                await db.SaveChangesAsync(ct);
            }
            await tx.CommitAsync(ct); return Ok(new EmojiDto(item.Id.ToString(), item.Name));
        }
        catch (CommunityFailure e) { return Problem(statusCode: e.Status, title: e.Message); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }
    [HttpPost("{id:guid}/delete"), EnableRateLimiting("community-commands")]
    public async Task<IActionResult> Delete(Guid community, Guid id, CancellationToken ct)
    {
        try { await using var tx = await db.Database.BeginTransactionAsync(ct); await Guard(community, true, ct);
            var item = await db.CommunityEmojis.SingleOrDefaultAsync(e => e.Id == id && e.CommunityId == community, ct);
            if (item is null) throw new CommunityFailure(404, "Emoji is unavailable.");
            if (!item.Deleted) { item.Deleted = true; CommunityAudit.Add(db, community, Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!), "emoji.deleted", item.Id); }
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return NoContent(); }
        catch (CommunityFailure e) { return Problem(statusCode: e.Status, title: e.Message); }
    }
    [HttpGet("{id:guid}/image")]
    public async Task<IActionResult> Image(Guid community, Guid id, CancellationToken ct)
    {
        try { await using var tx = await db.Database.BeginTransactionAsync(ct); await Guard(community, false, ct);
            if (!await db.CommunityEmojis.AnyAsync(e => e.Id == id && e.CommunityId == community && !e.Deleted, ct)) throw new CommunityFailure(404, "Emoji is unavailable.");
            var stream = files.Open(id); try { await tx.CommitAsync(ct); } catch { await stream.DisposeAsync(); throw; }
            Response.Headers.XContentTypeOptions = "nosniff"; Response.Headers.ContentSecurityPolicy = "sandbox; default-src 'none'"; return File(stream, "image/png"); }
        catch (CommunityFailure e) { return Problem(statusCode: e.Status, title: e.Message); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }
}
