using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Foundation;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace App.IntegrationTests;

public sealed class PostgresTests
{
    [Fact]
    [Trait("Category", "PostgreSQL")]
    public async Task ActualPostgres18AcceptsEfConnectionAndRepeatedReadinessProbes()
    {
        var connection = Environment.GetEnvironmentVariable("DOSVYAZI_TEST_CONNECTION");
        Assert.False(string.IsNullOrWhiteSpace(connection), "Set DOSVYAZI_TEST_CONNECTION or run npm run test:database.");
        await using var factory = new FoundationFactory(connection: connection);
        using var scope = factory.Services.CreateScope();
        var database = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", database.Database.ProviderName);
        await database.Database.OpenConnectionAsync();
        await using var command = database.Database.GetDbConnection().CreateCommand();
        command.CommandText = "SELECT current_setting('server_version_num')::integer";
        var version = Convert.ToInt32(await command.ExecuteScalarAsync());
        Assert.InRange(version, 180000, 189999);
        using var client = factory.CreateClient();
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var response = await client.GetAsync("/health/ready");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var result = await response.Content.ReadFromJsonAsync<ReadinessResponse>();
            Assert.Equal("healthy", result?.Status);
            Assert.Equal("healthy", result?.Checks["database"]);
        }
    }
}
