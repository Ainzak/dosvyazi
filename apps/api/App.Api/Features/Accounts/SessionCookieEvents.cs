using System.Security.Claims;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace App.Api.Features.Accounts;

public sealed class SessionCookieEvents(AppDbContext database, IOptions<IdentityOptions> identityOptions) : CookieAuthenticationEvents
{
    public const string SessionClaim = "dosvyazi:session";

    public override async Task ValidatePrincipal(CookieValidatePrincipalContext context)
    {
        var userIdText = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var sessionIdText = context.Principal?.FindFirstValue(SessionClaim);
        var valid = false;
        if (Guid.TryParse(userIdText, out var userId) && Guid.TryParse(sessionIdText, out var sessionId))
        {
            var stamp = context.Principal?.FindFirstValue(identityOptions.Value.ClaimsIdentity.SecurityStampClaimType);
            valid = await database.Sessions.AsNoTracking().AnyAsync(session =>
                session.Id == sessionId && session.UserId == userId && session.RevokedAt == null &&
                session.ExpiresAt > DateTimeOffset.UtcNow && session.User.SecurityStamp == stamp,
                context.HttpContext.RequestAborted);
        }
        if (!valid)
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
        }
    }

    public override Task RedirectToLogin(RedirectContext<CookieAuthenticationOptions> context)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    }

    public override Task RedirectToAccessDenied(RedirectContext<CookieAuthenticationOptions> context)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    }
}
