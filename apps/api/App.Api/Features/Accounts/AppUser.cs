using Microsoft.AspNetCore.Identity;

namespace App.Api.Features.Accounts;

public sealed class AppUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = string.Empty;
    public string About { get; set; } = "";
    public string Interests { get; set; } = "";
    public string Games { get; set; } = "";
    public string LookingFor { get; set; } = "";
}

public sealed class UserSession
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}
