using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MultipleVoiceChannels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_VoiceRooms",
                table: "VoiceRooms");

            migrationBuilder.DropPrimaryKey(
                name: "PK_VoiceRoleRules",
                table: "VoiceRoleRules");

            migrationBuilder.AddColumn<Guid>(
                name: "ChannelId",
                table: "VoiceRooms",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "CategoryId",
                table: "VoiceRooms",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Name",
                table: "VoiceRooms",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "ChannelId",
                table: "VoiceRoleRules",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "ChannelId",
                table: "VoiceLeases",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            // Preserve existing bindings, generations, active leases and category rules.
            // Communities that never joined voice also receive their default channel.
            migrationBuilder.Sql("""
                UPDATE "VoiceRooms" r SET "ChannelId" = r."CommunityId", "Name" = 'Voice room', "CategoryId" = c."VoiceCategoryId"
                FROM "Communities" c WHERE c."Id" = r."CommunityId";
                INSERT INTO "VoiceRooms" ("ChannelId", "CommunityId", "Id", "Name", "CategoryId", "Generation", "Status", "OperationId", "CompletedAt", "ControlUnavailable", "NextCheckAt")
                SELECT c."Id", c."Id", gen_random_uuid(), 'Voice room', c."VoiceCategoryId", 1, 'Ready', NULL, NULL, false, CURRENT_TIMESTAMP
                FROM "Communities" c WHERE NOT EXISTS (SELECT 1 FROM "VoiceRooms" r WHERE r."CommunityId" = c."Id");
                UPDATE "VoiceLeases" SET "ChannelId" = "CommunityId";
                UPDATE "VoiceRoleRules" SET "ChannelId" = "CommunityId";
                """);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_VoiceRooms_CommunityId_ChannelId",
                table: "VoiceRooms",
                columns: new[] { "CommunityId", "ChannelId" });

            migrationBuilder.AddPrimaryKey(
                name: "PK_VoiceRooms",
                table: "VoiceRooms",
                column: "ChannelId");

            migrationBuilder.AddPrimaryKey(
                name: "PK_VoiceRoleRules",
                table: "VoiceRoleRules",
                columns: new[] { "CommunityId", "ChannelId", "RoleId" });

            migrationBuilder.CreateIndex(
                name: "IX_VoiceRooms_CommunityId_CategoryId",
                table: "VoiceRooms",
                columns: new[] { "CommunityId", "CategoryId" });

            migrationBuilder.CreateIndex(
                name: "IX_VoiceRooms_CommunityId_Name",
                table: "VoiceRooms",
                columns: new[] { "CommunityId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_VoiceRoleRules_CommunityId_RoleId",
                table: "VoiceRoleRules",
                columns: new[] { "CommunityId", "RoleId" });

            migrationBuilder.CreateIndex(
                name: "IX_VoiceLeases_CommunityId_ChannelId",
                table: "VoiceLeases",
                columns: new[] { "CommunityId", "ChannelId" });

            migrationBuilder.AddForeignKey(
                name: "FK_VoiceLeases_VoiceRooms_CommunityId_ChannelId",
                table: "VoiceLeases",
                columns: new[] { "CommunityId", "ChannelId" },
                principalTable: "VoiceRooms",
                principalColumns: new[] { "CommunityId", "ChannelId" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_VoiceRoleRules_VoiceRooms_CommunityId_ChannelId",
                table: "VoiceRoleRules",
                columns: new[] { "CommunityId", "ChannelId" },
                principalTable: "VoiceRooms",
                principalColumns: new[] { "CommunityId", "ChannelId" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_VoiceRooms_Categories_CommunityId_CategoryId",
                table: "VoiceRooms",
                columns: new[] { "CommunityId", "CategoryId" },
                principalTable: "Categories",
                principalColumns: new[] { "CommunityId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Multiple voice channels cannot be flattened without losing channels or authorization rules. Restore a verified pre-upgrade backup with the matching application instead.");
        }
    }
}
