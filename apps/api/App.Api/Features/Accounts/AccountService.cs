using System.Security.Claims;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using App.Api.Features.Voice;

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
