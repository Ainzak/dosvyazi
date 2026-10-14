using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MediaSharing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_VoiceRoleRules_Bits",
                table: "VoiceRoleRules");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CommunityRoles_Grants",
                table: "CommunityRoles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ChannelRoleRules_Bits",
                table: "ChannelRoleRules");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CategoryRoleRules_Bits",
                table: "CategoryRoleRules");

            migrationBuilder.AddColumn<bool>(
                name: "CanShareScreen",
                table: "VoiceLeases",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanUseCamera",
                table: "VoiceLeases",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddCheckConstraint(
                name: "CK_VoiceRoleRules_Bits",
                table: "VoiceRoleRules",
                sql: "\"Allow\" BETWEEN 0 AND 65535 AND \"Deny\" BETWEEN 0 AND 65535 AND ((\"Allow\" | \"Deny\") & 280) = 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CommunityRoles_Grants",
                table: "CommunityRoles",
                sql: "\"Grants\" BETWEEN 0 AND 65535 AND (\"Grants\" & 280) = 0 AND \"Rank\" BETWEEN 0 AND 1000");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ChannelRoleRules_Bits",
                table: "ChannelRoleRules",
                sql: "\"Allow\" BETWEEN 0 AND 65535 AND \"Deny\" BETWEEN 0 AND 65535 AND ((\"Allow\" | \"Deny\") & 280) = 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CategoryRoleRules_Bits",
                table: "CategoryRoleRules",
                sql: "\"Allow\" BETWEEN 0 AND 65535 AND \"Deny\" BETWEEN 0 AND 65535 AND ((\"Allow\" | \"Deny\") & 280) = 0");

            // Preserve the former speaking boundary, including explicit category/voice Deny.
            // Advance policy versions so an editor opened before upgrade cannot erase the new grants.
            migrationBuilder.Sql("""
                UPDATE "CommunityRoles" SET "Grants" = "Grants" | 49152 WHERE ("Grants" & 4096) <> 0;
                UPDATE "CategoryRoleRules" SET
                    "Allow" = "Allow" | CASE WHEN ("Allow" & 4096) <> 0 THEN 49152 ELSE 0 END,
                    "Deny" = "Deny" | CASE WHEN ("Deny" & 4096) <> 0 THEN 49152 ELSE 0 END;
                UPDATE "VoiceRoleRules" SET
                    "Allow" = "Allow" | CASE WHEN ("Allow" & 4096) <> 0 THEN 49152 ELSE 0 END,
                    "Deny" = "Deny" | CASE WHEN ("Deny" & 4096) <> 0 THEN 49152 ELSE 0 END;
                UPDATE "Communities" SET "PolicyVersion" = "PolicyVersion" + 1;
                UPDATE "VoiceRooms" SET "Status" = 'Pending', "OperationId" = gen_random_uuid(), "NextCheckAt" = now()
                    WHERE "CommunityId" IN (SELECT "CommunityId" FROM "VoiceLeases" WHERE "Active");
                UPDATE "VoiceLeases" SET "Active" = false WHERE "Active";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "VoiceRooms" SET "Status" = 'Pending', "OperationId" = gen_random_uuid(), "NextCheckAt" = now()
                    WHERE "CommunityId" IN (SELECT "CommunityId" FROM "VoiceLeases" WHERE "Active");
                UPDATE "VoiceLeases" SET "Active" = false WHERE "Active";
                UPDATE "Communities" SET "PolicyVersion" = "PolicyVersion" + 1;
                UPDATE "CommunityRoles" SET "Grants" = "Grants" & 16383;
                UPDATE "CategoryRoleRules" SET "Allow" = "Allow" & 16383, "Deny" = "Deny" & 16383;
                UPDATE "ChannelRoleRules" SET "Allow" = "Allow" & 16383, "Deny" = "Deny" & 16383;
                UPDATE "VoiceRoleRules" SET "Allow" = "Allow" & 16383, "Deny" = "Deny" & 16383;
                """);
            migrationBuilder.DropCheckConstraint(
                name: "CK_VoiceRoleRules_Bits",
                table: "VoiceRoleRules");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CommunityRoles_Grants",
                table: "CommunityRoles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ChannelRoleRules_Bits",
                table: "ChannelRoleRules");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CategoryRoleRules_Bits",
                table: "CategoryRoleRules");

            migrationBuilder.DropColumn(
                name: "CanShareScreen",
                table: "VoiceLeases");

            migrationBuilder.DropColumn(
                name: "CanUseCamera",
                table: "VoiceLeases");

            migrationBuilder.AddCheckConstraint(
                name: "CK_VoiceRoleRules_Bits",
                table: "VoiceRoleRules",
                sql: "\"Allow\" BETWEEN 0 AND 16383 AND \"Deny\" BETWEEN 0 AND 16383 AND ((\"Allow\" | \"Deny\") & 280) = 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CommunityRoles_Grants",
                table: "CommunityRoles",
                sql: "\"Grants\" BETWEEN 0 AND 16383 AND (\"Grants\" & 280) = 0 AND \"Rank\" BETWEEN 0 AND 1000");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ChannelRoleRules_Bits",
                table: "ChannelRoleRules",
                sql: "\"Allow\" BETWEEN 0 AND 16383 AND \"Deny\" BETWEEN 0 AND 16383 AND ((\"Allow\" | \"Deny\") & 280) = 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CategoryRoleRules_Bits",
                table: "CategoryRoleRules",
                sql: "\"Allow\" BETWEEN 0 AND 16383 AND \"Deny\" BETWEEN 0 AND 16383 AND ((\"Allow\" | \"Deny\") & 280) = 0");
        }
    }
}
