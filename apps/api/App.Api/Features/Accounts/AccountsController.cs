using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Authentication;

namespace App.Api.Features.Accounts;

[ApiController]
[Route("api/v1/account")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AccountsController(AccountService accounts, UserManager<AppUser> users,
    IAntiforgery antiforgery) : ControllerBase
{
    [AllowAnonymous]
    [HttpGet("csrf")]
    [ProducesResponseType<CsrfResponse>(StatusCodes.Status200OK)]
    public ActionResult<CsrfResponse> Csrf() => new CsrfResponse(antiforgery.GetAndStoreTokens(HttpContext).RequestToken!);

    [AllowAnonymous]
    [EnableRateLimiting("accounts")]
    [HttpPost("register")]
    [ProducesResponseType<UserProfile>(StatusCodes.Status201Created)]
    public async Task<ActionResult<UserProfile>> Register(RegisterRequest request, CancellationToken cancellationToken)
    {
        if (!AccountService.ValidDisplayName(request.DisplayName))
            return Problem(statusCode: 400, title: "Display name must contain 2 to 40 characters and no control characters.");
        var profile = await accounts.RegisterAsync(request, User, cancellationToken);
        return profile is null ? Problem(statusCode: 409, title: "Unable to create an account with these details. Check the email and password requirements.")
            : Created("/api/v1/account/me", profile);
    }

    [AllowAnonymous]
    [EnableRateLimiting("accounts")]
    [HttpPost("login")]
    [ProducesResponseType<UserProfile>(StatusCodes.Status200OK)]
    public async Task<ActionResult<UserProfile>> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        var profile = await accounts.LoginAsync(request, User, cancellationToken);
        return profile is null ? Problem(statusCode: 401, title: "Unable to sign in. Check your email and password or try again later.") : Ok(profile);
    }

    [AllowAnonymous]
    [HttpPost("logout")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        await accounts.RevokeCurrentAsync(User, cancellationToken);
        await HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
        return NoContent();
    }

    [Authorize]
    [HttpGet("me")]
    [ProducesResponseType<UserProfile>(StatusCodes.Status200OK)]
    public async Task<ActionResult<UserProfile>> Me()
    {
        var user = await users.GetUserAsync(User);
        return user is null ? Unauthorized() : AccountService.Profile(user);
    }

    [Authorize]
    [HttpPut("me")]
    [ProducesResponseType<UserProfile>(StatusCodes.Status200OK)]
    public async Task<ActionResult<UserProfile>> Update(UpdateProfileRequest request)
    {
        if (!AccountService.ValidDisplayName(request.DisplayName))
            return Problem(statusCode: 400, title: "Display name must contain 2 to 40 characters and no control characters.");
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        user.DisplayName = request.DisplayName.Trim();
        var result = await users.UpdateAsync(user);
        return result.Succeeded ? Ok(AccountService.Profile(user)) : Problem(statusCode: 409, title: "Your profile changed. Reload it and try again.");
    }
}
