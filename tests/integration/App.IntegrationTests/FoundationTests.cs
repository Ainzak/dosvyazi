using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Foundation;
using App.Core.Foundation;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace App.IntegrationTests;

public sealed class FoundationFactory(string environment = "Development", string? connection = null, int permitLimit = 30)
    : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(environment);
        builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["ConnectionStrings:Dosvyazi"] = connection,
                ["Accounts:PermitLimit"] = permitLimit.ToString(),
                ["Messages:WorkerEnabled"] = "false",
                ["DataProtection:KeyPath"] = Path.Combine(Path.GetFullPath("../../..", _.HostingEnvironment.ContentRootPath), ".local", "artifacts", "test-keys"),
            }));
    }
}

public sealed class FoundationTests
{
    [Fact]
    public async Task SystemContractAndLivenessDoNotDependOnDatabase()
    {
        await using var factory = new FoundationFactory();
        using var client = factory.CreateClient();
        var info = await client.GetFromJsonAsync<FoundationInfo>("/api/v1/system");
        Assert.Equal(new FoundationInfo("Dosvyazi", "Development foundation"), info);
        var live = await client.GetFromJsonAsync<LivenessResponse>("/health/live");
        Assert.Equal("healthy", live?.Status);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("Host=127.0.0.1;Port=1;Database=unavailable;Username=test;Password=must_not_be_exposed;Timeout=1;Command Timeout=1")]
    public async Task MissingOrUnavailableDatabaseIsUnhealthyAndDoesNotLeakConfiguration(string? connection)
    {
        await using var factory = new FoundationFactory(connection: connection);
        using var client = factory.CreateClient();
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var response = await client.GetAsync("/health/ready");
            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
            var readiness = await response.Content.ReadFromJsonAsync<ReadinessResponse>();
            Assert.Equal("unhealthy", readiness?.Status);
            Assert.Equal("unhealthy", readiness?.Checks["database"]);
            var body = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain("Password", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("must_not_be_exposed", body);
            Assert.DoesNotContain("Exception", body);
        }
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
    }

    [Theory]
    [InlineData("Development", HttpStatusCode.OK)]
    [InlineData("Production", HttpStatusCode.NotFound)]
    public async Task OpenApiIsAvailableOnlyInDevelopment(string environment, HttpStatusCode expected)
    {
        await using var factory = new FoundationFactory(environment);
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/openapi/v1.json");
        Assert.Equal(expected, response.StatusCode);
        if (expected == HttpStatusCode.OK)
        {
            var body = await response.Content.ReadAsStringAsync();
            Assert.Contains("/api/v1/system", body);
            Assert.Contains("/health/ready", body);
            Assert.DoesNotContain("weatherforecast", body, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task UnknownApiRouteReturnsProblemDetails()
    {
        await using var factory = new FoundationFactory();
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/api/v1/missing");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }
}
