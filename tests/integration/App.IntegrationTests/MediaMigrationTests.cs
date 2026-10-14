using App.Api.Features.Accounts;
using App.Api.Features.Communities;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace App.IntegrationTests;

[Trait("Category", "PostgreSQL")]
public sealed class MediaMigrationTests
{
    [Fact]
    public async Task UpgradeCopiesSpeakingAllowsAndDeniesWithoutWideningListeners()
    {
        var original = Environment.GetEnvironmentVariable("DOSVYAZI_TEST_CONNECTION");
        Assert.False(string.IsNullOrWhiteSpace(original));
        var schema = $"dosvyazi_media_upgrade_{Guid.NewGuid():N}";
        await using var connection = new NpgsqlConnection(original); await connection.OpenAsync();
        await using var create = new NpgsqlCommand($"CREATE SCHEMA \"{schema}\"", connection); await create.ExecuteNonQueryAsync();
        // Keep this isolated synthetic schema; existing data is never downgraded or dropped.
        var scoped = new NpgsqlConnectionStringBuilder(original) { SearchPath = schema }.ConnectionString;
        await using var factory = new FoundationFactory(connection: scoped);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.GetService<IMigrator>().MigrateAsync("20261013141307_Gatherings");
        var owner = Guid.NewGuid(); var speaker = Guid.NewGuid(); var listener = Guid.NewGuid(); var categoryDenied = Guid.NewGuid();
        var community = Guid.NewGuid(); var role = Guid.NewGuid(); var category = Guid.NewGuid();
        db.Users.AddRange(new[] { owner, speaker, listener, categoryDenied }.Select(id => new AppUser { Id = id, DisplayName = "Synthetic migration member", Email = $"migration-{id:N}@example.test", NormalizedEmail = $"MIGRATION-{id:N}@EXAMPLE.TEST", UserName = id.ToString("N"), NormalizedUserName = id.ToString("N").ToUpperInvariant() }));
        db.Communities.Add(new Community { Id = community, OwnerId = owner, Name = "Migration test", ClientRequestId = Guid.NewGuid(), CreatedAt = DateTimeOffset.UtcNow });
        db.Memberships.AddRange(new[] { owner, speaker, listener, categoryDenied }.Select(id => new Membership { CommunityId = community, UserId = id, JoinedAt = DateTimeOffset.UtcNow }));
        db.Categories.Add(new Category { Id = category, CommunityId = community, Name = "Voice category" });
        db.CommunityRoles.AddRange(new CommunityRole { Id = community, CommunityId = community, Name = "everyone", Grants = 2049 },
            new CommunityRole { Id = role, CommunityId = community, Name = "speaker", Grants = 4096, Rank = 1 });
        db.MemberRoles.AddRange(new MemberRole { CommunityId = community, UserId = speaker, RoleId = role }, new MemberRole { CommunityId = community, UserId = categoryDenied, RoleId = role });
        db.CategoryRoleRules.Add(new CategoryRoleRule { CommunityId = community, CategoryId = category, RoleId = role, Deny = 4096 });
        // One direct voice allow overrides missing base grant, but cannot override a category denial.
        var direct = Guid.NewGuid(); db.CommunityRoles.Add(new CommunityRole { Id = direct, CommunityId = community, Name = "direct speaker", Rank = 1 });
        db.MemberRoles.Add(new MemberRole { CommunityId = community, UserId = speaker, RoleId = direct });
        db.MemberRoles.Remove(db.MemberRoles.Local.Single(item => item.UserId == speaker && item.RoleId == role));
        db.VoiceRoleRules.Add(new VoiceRoleRule { CommunityId = community, RoleId = direct, Allow = 4096 });
        await db.SaveChangesAsync();
        (await db.Communities.SingleAsync()).VoiceCategoryId = category;
        var session = Guid.NewGuid(); var lease = Guid.NewGuid();
        db.Sessions.Add(new UserSession { Id = session, UserId = speaker, CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddHours(1) });
        db.VoiceRooms.Add(new App.Api.Features.Voice.VoiceRoomBinding { CommunityId = community, Id = Guid.NewGuid() });
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "VoiceLeases" ("Id", "UserId", "CommunityId", "AuthSessionId", "SecurityStamp", "Generation", "Active", "ExpiresAt", "CanSpeak", "DisconnectedByModerator")
            VALUES ({lease}, {speaker}, {community}, {session}, {"synthetic"}, 1, true, {DateTimeOffset.UtcNow.AddMinutes(1)}, true, false)
            """);
        await db.Database.MigrateAsync(); await db.Database.MigrateAsync(); db.ChangeTracker.Clear();
        var allowed = await ChannelAccess.VoiceAsync(db, community, speaker, default);
        Assert.True(allowed.Speak); Assert.True(allowed.ShareScreen); Assert.True(allowed.UseCamera);
        foreach (var user in new[] { listener, categoryDenied })
        {
            var denied = await ChannelAccess.VoiceAsync(db, community, user, default);
            Assert.True(denied.Connect); Assert.False(denied.Speak); Assert.False(denied.ShareScreen); Assert.False(denied.UseCamera);
        }
        Assert.Equal(49152 | 4096, (await db.CommunityRoles.SingleAsync(item => item.Id == role)).Grants);
        Assert.Equal(49152 | 4096, (await db.CategoryRoleRules.SingleAsync()).Deny);
        Assert.Equal(49152 | 4096, (await db.VoiceRoleRules.SingleAsync()).Allow);
        Assert.Equal(2, (await db.Communities.SingleAsync()).PolicyVersion);
        Assert.False((await db.VoiceLeases.SingleAsync()).Active);
        var room = await db.VoiceRooms.SingleAsync(); Assert.Equal("Pending", room.Status); Assert.NotNull(room.OperationId);
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
    }
}
