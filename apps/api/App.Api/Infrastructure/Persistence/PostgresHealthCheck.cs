using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace App.Api.Infrastructure.Persistence;

public sealed class PostgresHealthCheck(IServiceScopeFactory scopeFactory, IConfiguration configuration) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(configuration.GetConnectionString("Dosvyazi")))
        {
            return HealthCheckResult.Unhealthy("Database configuration is required.");
        }

        using var scope = scopeFactory.CreateScope();
        var database = scope.ServiceProvider.GetRequiredService<AppDbContext>().Database;
        return await database.CanConnectAsync(cancellationToken)
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Unhealthy("Database is unavailable.");
    }
}
