using System.Security.Claims;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using App.Api.Features.Voice;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace App.Api.Features.Accounts;

public sealed class AccountService(AppDbContext database, UserManager<AppUser> users, SignInManager<AppUser> signIn)
{
    public static UserProfile Profile(AppUser user) => new(user.Id.ToString(), user.Email!, user.DisplayName);
    public static bool ValidDisplayName(string name) => name.Trim().Length is >= 2 and <= 40 && !name.Any(char.IsControl);

    public async Task<UserProfile?> RegisterAsync(RegisterRequest request, ClaimsPrincipal current, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var email = request.Email.Trim();
        var user = new AppUser { Id = Guid.NewGuid(), UserName = email, Email = email, DisplayName = request.DisplayName.Trim() };
        try
        {
            var result = await users.CreateAsync(user, request.Password);
            if (!result.Succeeded) return null;
            var session = await NewSessionAsync(user, current, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            await SetCookieAsync(user, session);
            return Profile(user);
        }
        catch (DbUpdateException exception) when (exception.InnerException is Npgsql.PostgresException { SqlState: "23505" })
        {
            return null;
        }
    }

    public async Task<UserProfile?> LoginAsync(LoginRequest request, ClaimsPrincipal current, CancellationToken cancellationToken)
    {
        var user = await users.FindByEmailAsync(request.Email.Trim());
        if (user is null || !(await signIn.CheckPasswordSignInAsync(user, request.Password, lockoutOnFailure: true)).Succeeded)
            return null;
        var session = await NewSessionAsync(user, current, cancellationToken);
        await SetCookieAsync(user, session);
        return Profile(user);
    }

    public async Task<string?> CreateResetLinkAsync(string email)
    {
        var user = await users.FindByEmailAsync(email.Trim());
        if (user is null) return null;
        var token = await users.GeneratePasswordResetTokenAsync(user);
        // Fragment keeps the bearer credential out of server access logs/referrers.
        var code = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
        return $"/reset-password#email={Uri.EscapeDataString(user.Email!)}&code={code}";
    }

    public async Task<bool> ResetPasswordAsync(ResetPasswordRequest request, CancellationToken ct)
    {
        string token;
        try { token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(request.Code)); }
        catch (FormatException) { return false; }
        var id = await database.Users.AsNoTracking().Where(u => u.NormalizedEmail == users.NormalizeEmail(request.Email.Trim()))
            .Select(u => (Guid?)u.Id).SingleOrDefaultAsync(ct);
        if (id is null) return false;
        await using var transaction = await database.Database.BeginTransactionAsync(ct);
        var user = await database.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {id.Value} FOR UPDATE").SingleAsync(ct);
        if (!(await users.ResetPasswordAsync(user, token, request.Password)).Succeeded) return false;
        var communities = await database.VoiceLeases.Where(l => l.UserId == user.Id && l.Active)
            .Select(l => l.CommunityId).Distinct().OrderBy(c => c).ToArrayAsync(ct);
        foreach (var community in communities)
        {
            await database.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(ct);
            await VoiceTransitions.RevokeMemberAsync(database, community, user.Id, ct);
        }
        await database.Sessions.Where(s => s.UserId == user.Id && s.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(s => s.RevokedAt, DateTimeOffset.UtcNow), ct);
        await database.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return true;
    }

    public async Task RevokeCurrentAsync(ClaimsPrincipal current, CancellationToken cancellationToken)
    {
        if (Guid.TryParse(current.FindFirstValue(SessionCookieEvents.SessionClaim), out var sessionId) &&
            Guid.TryParse(current.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
        {
            await using var ownedTransaction = database.Database.CurrentTransaction is null
                ? await database.Database.BeginTransactionAsync(cancellationToken) : null;
            await database.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {userId} FOR UPDATE").AnyAsync(cancellationToken);
            var communities = await database.VoiceLeases.Where(item => item.UserId == userId && item.AuthSessionId == sessionId && item.Active)
                .Select(item => item.CommunityId).Distinct().OrderBy(item => item).ToArrayAsync(cancellationToken);
            foreach (var community in communities)
            {
                await database.Communities.FromSqlInterpolated($"SELECT * FROM \"Communities\" WHERE \"Id\" = {community} FOR UPDATE").AnyAsync(cancellationToken);
                await VoiceTransitions.RevokeMemberAsync(database, community, userId, cancellationToken);
            }
            await database.SaveChangesAsync(cancellationToken);
            await database.Sessions.Where(session => session.Id == sessionId && session.UserId == userId && session.RevokedAt == null)
                .ExecuteUpdateAsync(setters => setters.SetProperty(session => session.RevokedAt, DateTimeOffset.UtcNow), cancellationToken);
            if (ownedTransaction is not null) await ownedTransaction.CommitAsync(cancellationToken);
        }
    }

    private async Task<UserSession> NewSessionAsync(AppUser user, ClaimsPrincipal current, CancellationToken cancellationToken)
    {
        await RevokeCurrentAsync(current, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var session = new UserSession { Id = Guid.NewGuid(), UserId = user.Id, CreatedAt = now, ExpiresAt = now.AddHours(12) };
        database.Sessions.Add(session);
        await database.SaveChangesAsync(cancellationToken);
        return session;
    }

    private Task SetCookieAsync(AppUser user, UserSession session) => signIn.SignInWithClaimsAsync(user,
        new AuthenticationProperties { IsPersistent = false, ExpiresUtc = session.ExpiresAt, AllowRefresh = false },
        [new Claim(SessionCookieEvents.SessionClaim, session.Id.ToString())]);
}
