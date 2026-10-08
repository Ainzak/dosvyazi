using Microsoft.EntityFrameworkCore;

namespace App.Api.Infrastructure.Persistence;

// Add actual feature entities and migrations with their first vertical slice.
public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options);
