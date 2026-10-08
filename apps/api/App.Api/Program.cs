using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Dosvyazi"),
        postgres => postgres.SetPostgresVersion(18, 0)));
builder.Services.AddHealthChecks()
    .AddCheck<PostgresHealthCheck>("database", tags: ["ready"], timeout: TimeSpan.FromSeconds(3));

var app = builder.Build();

// Keep dependency failures observable without exposing configuration or exception details.
app.UseExceptionHandler();
app.UseStatusCodePages();
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapControllers();
app.Run();

// Integration tests exercise the real host/pipeline.
public partial class Program;
