using System.ComponentModel.DataAnnotations;

namespace App.Api.Features.Accounts;

public sealed record RegisterRequest(
    [Required, EmailAddress, StringLength(254)] string Email,
    [Required, StringLength(128, MinimumLength = 12)] string Password,
    [Required, StringLength(40, MinimumLength = 2)] string DisplayName);
public sealed record LoginRequest(
    [Required, EmailAddress, StringLength(254)] string Email,
    [Required, StringLength(128)] string Password);
public sealed record UpdateProfileRequest([Required, StringLength(40, MinimumLength = 2)] string DisplayName);
public sealed record UserProfile(string Id, string Email, string DisplayName);
public sealed record CsrfResponse(string RequestToken);
