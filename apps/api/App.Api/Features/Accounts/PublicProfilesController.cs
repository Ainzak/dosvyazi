using System.Security.Claims;
using System.ComponentModel.DataAnnotations;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Accounts;
public sealed record PublicProfileDto(string Id, string DisplayName, string About, string Interests, string Games, string LookingFor);
public sealed record ProfileDetailsRequest([StringLength(1000)] string About, [StringLength(500)] string Interests, [StringLength(500)] string Games, [StringLength(500)] string LookingFor);
[ApiController, Authorize, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/v1/profiles")]
public sealed class PublicProfilesController(AppDbContext db) : ControllerBase
{
    private static PublicProfileDto Dto(AppUser u) => new(u.Id.ToString(), u.DisplayName, u.About, u.Interests, u.Games, u.LookingFor);
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<PublicProfileDto>> Get(Guid id, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == id, ct);
        return user is null ? Problem(statusCode: 404, title: "Profile is unavailable.") : Ok(Dto(user));
    }
    [HttpPut("me"), EnableRateLimiting("community-commands"), RequestSizeLimit(16 * 1024)]
    public async Task<ActionResult<PublicProfileDto>> Save(ProfileDetailsRequest request, CancellationToken ct)
    {
        var values = new[] { request.About, request.Interests, request.Games, request.LookingFor };
        if (values.Any(v => v is null || v.Any(c => char.IsControl(c) && c is not '\n' and not '\r' and not '\t')))
            return Problem(statusCode: 422, title: "Use plain text without control characters.");
        var id = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {id} FOR UPDATE").SingleAsync(ct);
        user.About = request.About.Trim(); user.Interests = request.Interests.Trim(); user.Games = request.Games.Trim(); user.LookingFor = request.LookingFor.Trim();
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return Ok(Dto(user));
    }
}
