using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using App.Api.Features.Accounts;

namespace App.Api.Infrastructure.Persistence;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityUserContext<AppUser, Guid>(options)
{
    public DbSet<UserSession> Sessions => Set<UserSession>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<AppUser>(user =>
        {
            user.Property(item => item.DisplayName).HasMaxLength(40).IsRequired();
            user.Property(item => item.Email).IsRequired();
            user.Property(item => item.NormalizedEmail).IsRequired();
            user.HasIndex(item => item.NormalizedEmail).IsUnique();
        });
        builder.Entity<UserSession>(session =>
        {
            session.HasKey(item => item.Id);
            session.HasOne(item => item.User).WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);
            session.HasIndex(item => new { item.UserId, item.ExpiresAt });
        });
    }
}
