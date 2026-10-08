using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Accounts;
using App.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace App.IntegrationTests;

public sealed class AccountsDatabase : IAsyncLifetime
{
    public string Connection { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        var original = Environment.GetEnvironmentVariable("DOSVYAZI_TEST_CONNECTION");
        Assert.False(string.IsNullOrWhiteSpace(original), "Run npm run test:database for account persistence tests.");
        var schema = $"dosvyazi_auth_{Guid.NewGuid():N}";
        await using var connection = new NpgsqlConnection(original);
        await connection.OpenAsync();
        // Only a newly generated identifier is used; existing schemas/user data are untouched.
        await using var create = new NpgsqlCommand($"CREATE SCHEMA \"{schema}\"", connection);
        await create.ExecuteNonQueryAsync();
        Connection = new NpgsqlConnectionStringBuilder(original) { SearchPath = schema }.ConnectionString;
        await using var factory = new FoundationFactory(connection: Connection);
        using var scope = factory.Services.CreateScope();
        var database = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await database.Database.MigrateAsync();
        await database.Database.MigrateAsync();
        Assert.Empty(await database.Database.GetPendingMigrationsAsync());
    }

    // Retain synthetic schema until explicitly authorized cleanup; never drop user data as a test side effect.
    public Task DisposeAsync() => Task.CompletedTask;
}

[Trait("Category", "PostgreSQL")]
public sealed class AccountsTests(AccountsDatabase database) : IClassFixture<AccountsDatabase>
{
    private const string Password = "Synthetic passphrase 42";
    private FoundationFactory Factory(int permitLimit = 30) => new(connection: database.Connection, permitLimit: permitLimit);
    private static string Email() => $"test-{Guid.NewGuid():N}@example.test";
    private static HttpClient Client(FoundationFactory factory) => factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static async Task<string> Token(HttpClient client)
        => (await client.GetFromJsonAsync<CsrfResponse>("/api/v1/account/csrf"))!.RequestToken;

    private static async Task<HttpResponseMessage> Send(HttpClient client, string path, object? body = null, string method = "POST", string? token = null)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), $"/api/v1/account/{path}");
        request.Headers.Add("X-CSRF-TOKEN", token ?? await Token(client));
        if (body is not null) request.Content = JsonContent.Create(body);
        return await client.SendAsync(request);
    }

    private static async Task<UserProfile> Register(HttpClient client, string? email = null)
    {
        using var response = await Send(client, "register", new { Email = email ?? Email(), Password, DisplayName = "Test member" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<UserProfile>())!;
    }

    [Fact]
    public async Task RegisterProfileAndLogoutRevokeEvenCopiedCookie()
    {
        await using var factory = Factory();
        using var client = Client(factory);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/account/me")).StatusCode);
        using var registered = await Send(client, "register", new { Email = Email(), Password, DisplayName = "  Test member  " });
        Assert.Equal(HttpStatusCode.Created, registered.StatusCode);
        var cookie = registered.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith("dosvyazi.session=", StringComparison.Ordinal));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("domain=", cookie, StringComparison.OrdinalIgnoreCase);
        var profile = (await registered.Content.ReadFromJsonAsync<UserProfile>())!;
        Assert.Equal("Test member", profile.DisplayName);
        var json = await registered.Content.ReadAsStringAsync();
        Assert.DoesNotContain("password", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("securityStamp", json, StringComparison.OrdinalIgnoreCase);
        using var changed = await Send(client, "me", new { DisplayName = "Renamed member" }, "PUT");
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal("Renamed member", (await client.GetFromJsonAsync<UserProfile>("/api/v1/account/me"))!.DisplayName);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, "logout")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, "logout")).StatusCode);
        using var replay = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        replay.DefaultRequestHeaders.Add("Cookie", cookie.Split(';')[0]);
        Assert.Equal(HttpStatusCode.Unauthorized, (await replay.GetAsync("/api/v1/account/me")).StatusCode);
    }

    [Fact]
    public async Task MissingForgedCrossClientAndOldIdentityCsrfAreRejected()
    {
        await using var factory = Factory();
        using var client = Client(factory);
        var body = new { Email = Email(), Password, DisplayName = "Test member" };
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/account/register", body)).StatusCode);
        var anonymousToken = await Token(client);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, "register", body, token: "forged")).StatusCode);
        using var other = Client(factory);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, "register", body, token: await Token(other))).StatusCode);
        client.DefaultRequestHeaders.Add("Origin", "https://untrusted.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, "register", body)).StatusCode);
        client.DefaultRequestHeaders.Remove("Origin");
        Assert.Equal(HttpStatusCode.Created, (await Send(client, "register", body)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, "me", new { DisplayName = "New name" }, "PUT", anonymousToken)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(client, "me", new { DisplayName = "New name" }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, "logout", token: "forged")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/account/me")).StatusCode);
    }

    [Fact]
    public async Task ConcurrentCaseInsensitiveRegistrationCreatesOneAccount()
    {
        await using var factory = Factory();
        using var first = Client(factory);
        using var second = Client(factory);
        var email = Email();
        var responses = await Task.WhenAll(
            Send(first, "register", new { Email = email, Password, DisplayName = "First member" }),
            Send(second, "register", new { Email = email.ToUpperInvariant(), Password, DisplayName = "Second member" }));
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Created);
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict);
        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await context.Users.CountAsync(user => user.NormalizedEmail == email.ToUpperInvariant()));
        foreach (var response in responses) response.Dispose();
    }

    [Fact]
    public async Task ProfileCannotChangeAnotherAccountOrItsEmail()
    {
        await using var factory = Factory();
        using var first = Client(factory);
        using var second = Client(factory);
        var alice = await Register(first);
        var bob = await Register(second);
        for (var attempt = 0; attempt < 2; attempt++)
            Assert.Equal(HttpStatusCode.OK, (await Send(first, "me", new { DisplayName = "Alice", Id = bob.Id, Email = bob.Email }, "PUT")).StatusCode);
        var current = (await first.GetFromJsonAsync<UserProfile>("/api/v1/account/me"))!;
        Assert.Equal(alice.Id, current.Id);
        Assert.Equal(alice.Email, current.Email);
        Assert.Equal("Test member", (await second.GetFromJsonAsync<UserProfile>("/api/v1/account/me"))!.DisplayName);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(first, "me", new { DisplayName = "  " }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(first, "me", new { DisplayName = "Name\nwith newline" }, "PUT")).StatusCode);
    }

    [Fact]
    public async Task CorrectCredentialsWorkAndFailedAttemptsLockOut()
    {
        await using var factory = Factory();
        using var client = Client(factory);
        var profile = await Register(client);
        await Send(client, "logout");
        Assert.Equal(HttpStatusCode.OK, (await Send(client, "login", new { Email = profile.Email.ToUpperInvariant(), Password })).StatusCode);
        await Send(client, "logout");
        for (var attempt = 0; attempt < 5; attempt++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(client, "login", new { Email = profile.Email, Password = "incorrect" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(client, "login", new { Email = profile.Email, Password })).StatusCode);
    }

    [Fact]
    public async Task AuthenticationAttemptsAreBoundedWithProblemDetails()
    {
        await using var factory = Factory(permitLimit: 3);
        using var client = Client(factory);
        for (var attempt = 0; attempt < 3; attempt++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(client, "login", new { Email = Email(), Password })).StatusCode);
        using var response = await Send(client, "login", new { Email = Email(), Password });
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("60", response.Headers.GetValues("Retry-After").Single());
    }

    [Fact]
    public async Task ProductionSessionAndCsrfCookiesRequireHttps()
    {
        await using var factory = new FoundationFactory("Production", database.Connection);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        using var csrf = await client.GetAsync("/api/v1/account/csrf");
        Assert.Contains("secure", csrf.Headers.GetValues("Set-Cookie").Single(), StringComparison.OrdinalIgnoreCase);
        using var response = await Send(client, "register", new { Email = Email(), Password, DisplayName = "Secure member" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var cookie = response.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith("dosvyazi.session=", StringComparison.Ordinal));
        Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/account/me")).StatusCode);
    }

    [Fact]
    public async Task SecurityStampChangeInvalidatesExistingSessionImmediately()
    {
        await using var factory = Factory();
        using var client = Client(factory);
        var profile = await Register(client);
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = (await users.FindByIdAsync(profile.Id))!;
        Assert.True((await users.UpdateSecurityStampAsync(user)).Succeeded);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/account/me")).StatusCode);
    }

    [Fact]
    public async Task UnavailableSessionStorageFailsClosedWithoutLeakingConfiguration()
    {
        await using var factory = Factory();
        using var client = Client(factory);
        using var registration = await Send(client, "register", new { Email = Email(), Password, DisplayName = "Stored member" });
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);
        var cookie = registration.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith("dosvyazi.session=", StringComparison.Ordinal)).Split(';')[0];
        await using var unavailable = new FoundationFactory(connection: "Host=127.0.0.1;Port=1;Database=unavailable;Username=test;Password=must_not_be_exposed;Timeout=1;Command Timeout=1");
        using var replay = unavailable.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        replay.DefaultRequestHeaders.Add("Cookie", cookie);
        using var response = await replay.GetAsync("/api/v1/account/me");
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Stored member", body);
        Assert.DoesNotContain("must_not_be_exposed", body);
        Assert.DoesNotContain("Npgsql", body);
    }

    [Fact]
    public async Task InvalidRegistrationDoesNotPersistAnAccount()
    {
        await using var factory = Factory();
        using var client = Client(factory);
        var email = Email();
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, "register", new { Email = email, Password = "short", DisplayName = "Test member" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(client, "register", new { Email = email, Password = "aaaaaaaaaaaa", DisplayName = "Test member" })).StatusCode);
        using var scope = factory.Services.CreateScope();
        Assert.False(await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AnyAsync(user => user.NormalizedEmail == email.ToUpperInvariant()));
    }

    [Fact]
    public async Task SessionAndProtectionKeysSurviveHostRestartButExpiryIsEnforced()
    {
        string cookie;
        UserProfile profile;
        await using (var first = Factory())
        {
            using var client = Client(first);
            using var response = await Send(client, "register", new { Email = Email(), Password, DisplayName = "Persistent member" });
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            profile = (await response.Content.ReadFromJsonAsync<UserProfile>())!;
            cookie = response.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith("dosvyazi.session=", StringComparison.Ordinal)).Split(';')[0];
        }
        await using var restarted = Factory();
        using var replay = restarted.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        replay.DefaultRequestHeaders.Add("Cookie", cookie);
        Assert.Equal(profile, await replay.GetFromJsonAsync<UserProfile>("/api/v1/account/me"));
        using var scope = restarted.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Sessions.Where(session => session.UserId == Guid.Parse(profile.Id))
            .ExecuteUpdateAsync(setters => setters.SetProperty(session => session.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
        Assert.Equal(HttpStatusCode.Unauthorized, (await replay.GetAsync("/api/v1/account/me")).StatusCode);
    }
}
