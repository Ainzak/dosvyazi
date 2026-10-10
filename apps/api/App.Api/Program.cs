using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Features.Voice;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using System.Threading.RateLimiting;
using System.Globalization;

CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.GetCultureInfo("en");

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers(options => options.Filters.Add<CsrfFilter>());
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Dosvyazi"),
        postgres => postgres.SetPostgresVersion(18, 0)));
builder.Services.AddHealthChecks()
    .AddCheck<PostgresHealthCheck>("database", tags: ["ready"], timeout: TimeSpan.FromSeconds(3));

builder.Services.AddIdentityCore<AppUser>(options =>
{
    options.User.RequireUniqueEmail = true;
    options.User.AllowedUserNameCharacters = string.Empty;
    options.Password.RequiredLength = 12;
    options.Password.RequiredUniqueChars = 4;
    options.Password.RequireDigit = false;
    options.Password.RequireUppercase = false;
    options.Password.RequireLowercase = false;
    options.Password.RequireNonAlphanumeric = false;
    options.Lockout.MaxFailedAccessAttempts = 5;
    options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
}).AddEntityFrameworkStores<AppDbContext>().AddSignInManager();
builder.Services.AddScoped<AccountService>();
builder.Services.AddScoped<CommunityService>();
builder.Services.AddScoped<MessageService>();
builder.Services.AddOptions<VoiceOptions>().Bind(builder.Configuration.GetSection("Voice"))
    .Validate(voice => !voice.Enabled || (!string.IsNullOrWhiteSpace(voice.ApiKey) && voice.ApiSecret.Length >= 32 &&
        Uri.TryCreate(voice.ControlUrl, UriKind.Absolute, out var control) && control.Scheme is "http" or "https" &&
        Uri.TryCreate(voice.BrowserUrl, UriKind.Absolute, out var browser) && browser.Scheme is "ws" or "wss"),
        "Configure valid voice credentials and control/browser URLs.").ValidateOnStart();
builder.Services.AddHttpClient("voice-control", http => http.Timeout = TimeSpan.FromSeconds(3));
builder.Services.AddScoped<IVoiceGateway>(provider =>
{
    var voice = provider.GetRequiredService<Microsoft.Extensions.Options.IOptions<VoiceOptions>>().Value;
    return voice.Enabled ? new LiveKitGateway(provider.GetRequiredService<IHttpClientFactory>().CreateClient("voice-control"),
        new Uri(voice.ControlUrl), voice.ApiKey, voice.ApiSecret) : new UnavailableVoiceGateway();
});
builder.Services.AddScoped<VoiceService>();
builder.Services.AddScoped<VoiceReconciler>();
builder.Services.AddHostedService<VoiceWorker>();
builder.Services.AddScoped<EventPublisher>();
builder.Services.AddSingleton<MessageConnections>();
builder.Services.AddHostedService<OutboxWorker>();
builder.Services.AddSignalR(options => { options.EnableDetailedErrors = false; options.MaximumReceiveMessageSize = 4096; });
builder.Services.AddScoped<SessionCookieEvents>();
builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme)
    .AddCookie(IdentityConstants.ApplicationScheme, options =>
    {
        options.Cookie.Name = "dosvyazi.session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        options.Cookie.Path = "/";
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.SlidingExpiration = false;
        options.EventsType = typeof(SessionCookieEvents);
    });
builder.Services.AddAuthorization();
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = "dosvyazi.csrf";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
});
var keysPath = builder.Configuration["DataProtection:KeyPath"];
if (string.IsNullOrWhiteSpace(keysPath))
{
    if (!builder.Environment.IsDevelopment()) throw new InvalidOperationException("Configure a persistent DataProtection:KeyPath.");
    keysPath = Path.Combine(Path.GetFullPath("../../..", builder.Environment.ContentRootPath), ".local", "data-protection");
}
var protection = builder.Services.AddDataProtection().SetApplicationName("Dosvyazi").PersistKeysToFileSystem(new DirectoryInfo(keysPath));
if (OperatingSystem.IsWindows()) protection.ProtectKeysWithDpapi();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("voice-joins", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "anonymous", _ => new FixedWindowRateLimiterOptions
        { PermitLimit = 12, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }));
    options.AddPolicy("community-commands", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "anonymous", _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true,
        }));
    options.AddPolicy("accounts", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "local", _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = builder.Configuration.GetValue("Accounts:PermitLimit", 30),
            Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true,
        }));
    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        await Results.Problem(statusCode: 429, title: "Too many attempts. Try again in a minute.").ExecuteAsync(context.HttpContext);
    };
});

var app = builder.Build();

// Schema changes are explicit commands, never automatic on normal API startup.
if (args.Contains("--migrate", StringComparer.Ordinal))
{
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
    return;
}

// Keep dependency failures observable without exposing configuration or exception details.
app.UseExceptionHandler();
app.UseStatusCodePages();
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}
app.UseRouting();
app.UseMiddleware<SameOriginMiddleware>();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapControllers();
app.MapHub<MessagesHub>("/hubs/messages", options => options.CloseOnAuthenticationExpiration = true);
app.Run();

// Integration tests exercise the real host/pipeline.
public partial class Program;
