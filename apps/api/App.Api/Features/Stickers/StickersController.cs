using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;

namespace App.Api.Features.Stickers;

public sealed record CreatePackRequest(Guid ClientRequestId, [Required] string Name, [Required] string Title);
public sealed record SavePackRequest(bool Saved);
public sealed record SendStickerRequest(Guid ClientMessageId, Guid StickerId, string? Content);
public sealed record StickerPackDto(string Id, string Name, string Title, bool BuiltIn, bool Mine, bool Saved, int Count);
public sealed record StickerAssetDto(string Id, string Label, string Name, long Size, string ContentType);
public sealed record StickerPackDetail(StickerPackDto Pack, StickerAssetDto[] Stickers);

[ApiController, Authorize, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/v1/sticker-packs")]
public sealed class StickersController(AppDbContext db, AttachmentStore files, IOptions<IdentityOptions> identity) : ControllerBase
{
    private Guid Actor => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private static string Hash(object value) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private static bool Label(string value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 64 && !value.Any(char.IsControl);
    private async Task LockUser(CancellationToken ct)
    {
        await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {Actor} FOR UPDATE").AnyAsync(ct);
        var stamp = User.FindFirstValue(identity.Value.ClaimsIdentity.SecurityStampClaimType);
        if (!Guid.TryParse(User.FindFirstValue(SessionCookieEvents.SessionClaim), out var session) || !await db.Sessions.AnyAsync(s => s.Id == session && s.UserId == Actor && s.RevokedAt == null && s.ExpiresAt > DateTimeOffset.UtcNow && s.User.SecurityStamp == stamp, ct))
            throw new CommunityFailure(401, "Sign in again.");
    }
    private async Task<StickerPack> Pack(string name, bool write, CancellationToken ct)
    {
        var pack = await db.StickerPacks.FromSqlInterpolated($"SELECT * FROM \"StickerPacks\" WHERE \"Name\" = {name.ToLowerInvariant()} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (pack is null || pack.Deleted) throw new CommunityFailure(404, "Sticker or pack is unavailable.");
        if (write && (pack.BuiltIn || pack.OwnerId != Actor)) throw new CommunityFailure(403, "Only the pack creator can change it.");
        return pack;
    }
    private async Task<StickerPackDto> Dto(StickerPack pack, CancellationToken ct) => new(pack.Id.ToString(), pack.Name, pack.Title, pack.BuiltIn, pack.OwnerId == Actor,
        await db.SavedStickerPacks.AnyAsync(s => s.UserId == Actor && s.PackId == pack.Id, ct), await db.StickerAssets.CountAsync(s => s.PackId == pack.Id && !s.Deleted, ct));
    private async Task<ActionResult<T>> Execute<T>(Func<Task<T>> action, int status = 200)
    {
        try { return StatusCode(status, await action()); }
        catch (CommunityFailure e) { return Problem(statusCode: e.Status, title: e.Message); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" }) { return Problem(statusCode: 409, title: "This unique pack name is already in use."); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }
    [HttpGet]
    public Task<ActionResult<StickerPackDto[]>> Library(CancellationToken ct) => Execute(async () =>
        await db.StickerPacks.AsNoTracking().Where(p => !p.Deleted && (p.BuiltIn || p.OwnerId == Actor || db.SavedStickerPacks.Any(s => s.UserId == Actor && s.PackId == p.Id)))
            .OrderByDescending(p => p.BuiltIn).ThenBy(p => p.Title).Select(p => new StickerPackDto(p.Id.ToString(), p.Name, p.Title, p.BuiltIn, p.OwnerId == Actor,
                db.SavedStickerPacks.Any(s => s.UserId == Actor && s.PackId == p.Id), db.StickerAssets.Count(s => s.PackId == p.Id && !s.Deleted))).Take(200).ToArrayAsync(ct));
    [HttpGet("{name}")]
    public Task<ActionResult<StickerPackDetail>> Get(string name, CancellationToken ct) => Execute(async () =>
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var pack = await Pack(name, false, ct);
        var items = await db.StickerAssets.AsNoTracking().Where(s => s.PackId == pack.Id && !s.Deleted).OrderBy(s => s.Label).Select(s => new StickerAssetDto(s.Id.ToString(), s.Label, s.Filename, s.Size, s.ContentType)).ToArrayAsync(ct);
        var result = new StickerPackDetail(await Dto(pack, ct), items); await tx.CommitAsync(ct); return result;
    });
    [HttpPost, EnableRateLimiting("direct-starts"), RequestSizeLimit(4096)]
    public Task<ActionResult<StickerPackDto>> Create(CreatePackRequest request, CancellationToken ct) => Execute(async () =>
    {
        var name = request.Name.Trim().ToLowerInvariant();
        if (request.ClientRequestId == Guid.Empty || !Regex.IsMatch(name, "^[a-z0-9][a-z0-9_-]{2,31}$", RegexOptions.CultureInvariant) || !Label(request.Title)) throw new CommunityFailure(422, "Use a unique pack name of 3–32 lowercase letters, numbers, underscores or hyphens, and a title up to 64 characters.");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockUser(ct);
        var hash = Hash(new { name, request.Title }); var pack = await db.StickerPacks.SingleOrDefaultAsync(p => p.OwnerId == Actor && p.ClientRequestId == request.ClientRequestId, ct);
        if (pack is not null && pack.RequestHash != hash) throw new CommunityFailure(409, "This request ID was used for another pack.");
        if (pack?.Deleted == true) throw new CommunityFailure(409, "This pack was retired. Use a new request ID and name.");
        if (pack is null)
        {
            if (await db.StickerPacks.CountAsync(p => p.OwnerId == Actor && !p.Deleted, ct) >= 20) throw new CommunityFailure(409, "You can create up to 20 active packs.");
            pack = new() { Id = Guid.NewGuid(), OwnerId = Actor, Name = name, Title = request.Title, ClientRequestId = request.ClientRequestId, RequestHash = hash, CreatedAt = DateTimeOffset.UtcNow };
            db.StickerPacks.Add(pack); await db.SaveChangesAsync(ct);
        }
        var result = await Dto(pack, ct); await tx.CommitAsync(ct); return result;
    }, 201);
    [HttpPut("{name}/saved"), EnableRateLimiting("direct-commands")]
    public Task<ActionResult<StickerPackDto>> Save(string name, SavePackRequest request, CancellationToken ct) => Execute(async () =>
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockUser(ct); var pack = await Pack(name, false, ct);
        var saved = await db.SavedStickerPacks.SingleOrDefaultAsync(s => s.UserId == Actor && s.PackId == pack.Id, ct);
        if (request.Saved && saved is null)
        {
            if (await db.SavedStickerPacks.CountAsync(s => s.UserId == Actor, ct) >= 100) throw new CommunityFailure(409, "You can save up to 100 packs.");
            db.SavedStickerPacks.Add(new() { UserId = Actor, PackId = pack.Id });
        }
        else if (!request.Saved && saved is not null) db.SavedStickerPacks.Remove(saved);
        await db.SaveChangesAsync(ct); var result = await Dto(pack, ct); await tx.CommitAsync(ct); return result;
    });
    [HttpPost("{name}/stickers"), EnableRateLimiting("attachment-uploads")]
    [RequestSizeLimit(2 * 1024 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 2 * 1024 * 1024)]
    public Task<ActionResult<StickerAssetDto>> Upload(string name, [FromForm] Guid clientRequestId, [FromForm] string label, [FromForm] IFormFile file, CancellationToken ct) => Execute<StickerAssetDto>(async () =>
    {
        if (clientRequestId == Guid.Empty || !Label(label)) throw new CommunityFailure(422, "Use a request ID and sticker label up to 64 characters.");
        if (file.Length > 1024 * 1024) throw new CommunityFailure(413, "Choose a sticker up to 1 MiB.");
        var prepared = await AttachmentStore.PrepareAsync(file, ct); var type = StickerMedia.Validate(prepared);
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockUser(ct); var pack = await Pack(name, true, ct);
        var hash = Hash(new { label, prepared.Name, prepared.Hash }); var asset = await db.StickerAssets.SingleOrDefaultAsync(s => s.PackId == pack.Id && s.ClientRequestId == clientRequestId, ct);
        if (asset is not null && (asset.RequestHash != hash || asset.Deleted)) throw new CommunityFailure(409, "This sticker request was changed or removed. Use a new request ID.");
        if (asset is null)
        {
            if (await db.StickerAssets.CountAsync(s => s.PackId == pack.Id && !s.Deleted, ct) >= 64) throw new CommunityFailure(409, "A pack can contain up to 64 stickers.");
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(73421891)", ct);
            if (files.UsedBytes() + prepared.Bytes.Length > files.QuotaBytes) throw new CommunityFailure(409, "Attachment storage is full. Ask the operator to free space.");
            asset = new() { Id = Guid.NewGuid(), PackId = pack.Id, ClientRequestId = clientRequestId, Label = label, Filename = prepared.Name, Hash = prepared.Hash, RequestHash = hash, Size = prepared.Bytes.Length, ContentType = type };
            await files.WriteAsync(asset.Id, prepared.Bytes, ct); db.StickerAssets.Add(asset); await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct); return new(asset.Id.ToString(), asset.Label, asset.Filename, asset.Size, asset.ContentType);
    }, 201);
    [HttpPost("{name}/retire"), EnableRateLimiting("direct-commands")]
    public Task<ActionResult<bool>> Retire(string name, CancellationToken ct) => Execute(async () =>
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockUser(ct);
        var pack = await db.StickerPacks.FromSqlInterpolated($"SELECT * FROM \"StickerPacks\" WHERE \"Name\" = {name.ToLowerInvariant()} FOR UPDATE").SingleOrDefaultAsync(ct) ?? throw new CommunityFailure(404, "Sticker or pack is unavailable.");
        if (pack.BuiltIn || pack.OwnerId != Actor) throw new CommunityFailure(403, "Only the pack creator can change it.");
        pack.Deleted = true; foreach (var item in await db.StickerAssets.Where(s => s.PackId == pack.Id).ToArrayAsync(ct)) item.Deleted = true;
        await db.SavedStickerPacks.Where(s => s.PackId == pack.Id).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return true;
    });
    [HttpPost("{name}/stickers/{id:guid}/remove"), EnableRateLimiting("direct-commands")]
    public Task<ActionResult<bool>> Remove(string name, Guid id, CancellationToken ct) => Execute(async () =>
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockUser(ct); var pack = await Pack(name, true, ct);
        var item = await db.StickerAssets.SingleOrDefaultAsync(s => s.Id == id && s.PackId == pack.Id, ct) ?? throw new CommunityFailure(404, "Sticker or pack is unavailable.");
        item.Deleted = true; await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return true;
    });
    [HttpGet("{name}/stickers/{id:guid}")]
    public async Task<IActionResult> Download(string name, Guid id, CancellationToken ct)
    {
        var item = await db.StickerAssets.AsNoTracking().SingleOrDefaultAsync(s => s.Id == id && s.Pack.Name == name.ToLowerInvariant() && !s.Deleted && !s.Purged && !s.Pack.Deleted, ct);
        if (item is null) return Problem(statusCode: 404, title: "Sticker or pack is unavailable.");
        try { Response.Headers.XContentTypeOptions = "nosniff"; Response.Headers.ContentSecurityPolicy = "sandbox; default-src 'none'"; return File(files.Open(id), "application/octet-stream", item.Filename); }
        catch (IOException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
        catch (UnauthorizedAccessException) { return Problem(statusCode: 503, title: "Attachment storage is unavailable. Try again later."); }
    }
}
