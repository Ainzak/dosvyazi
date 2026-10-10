using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AccessHierarchyAndMessageModeration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ChannelEvents_Messages_MessageId_ChannelId_Sequence",
                table: "ChannelEvents");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_Messages_Id_ChannelId_Sequence",
                table: "Messages");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CommunityRoles_Grants",
                table: "CommunityRoles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ChannelRoleRules_Bits",
                table: "ChannelRoleRules");

            migrationBuilder.DropIndex(
                name: "IX_ChannelEvents_MessageId_ChannelId_Sequence",
                table: "ChannelEvents");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CategoryRoleRules_Bits",
                table: "CategoryRoleRules");

            migrationBuilder.AddColumn<bool>(
                name: "CanSpeak",
                table: "VoiceLeases",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "Deleted",
                table: "Messages",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "OriginalContentHash",
                table: "Messages",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "UpdatedAt",
                table: "Messages",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "Messages",
                type: "bigint",
                nullable: false,
                defaultValue: 1L);

            migrationBuilder.AddColumn<int>(
                name: "Rank",
                table: "CommunityRoles",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "VoiceCategoryId",
                table: "Communities",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "ChannelEvents",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "message.created");

            migrationBuilder.AddUniqueConstraint(
                name: "AK_Messages_Id_ChannelId",
                table: "Messages",
                columns: new[] { "Id", "ChannelId" });

            migrationBuilder.CreateTable(
                name: "AuditEntries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    TargetId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AuditEntries_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AuditEntries_Communities_CommunityId",
                        column: x => x.CommunityId,
                        principalTable: "Communities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MessageCommands",
                columns: table => new
                {
                    ChannelId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ResultVersion = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessageCommands", x => new { x.ChannelId, x.ActorId, x.ClientRequestId });
                    table.ForeignKey(
                        name: "FK_MessageCommands_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MessageCommands_Messages_MessageId_ChannelId",
                        columns: x => new { x.MessageId, x.ChannelId },
                        principalTable: "Messages",
                        principalColumns: new[] { "Id", "ChannelId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "VoiceRoleRules",
                columns: table => new
                {
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Allow = table.Column<int>(type: "integer", nullable: false),
                    Deny = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VoiceRoleRules", x => new { x.CommunityId, x.RoleId });
                    table.CheckConstraint("CK_VoiceRoleRules_Bits", "\"Allow\" BETWEEN 0 AND 16383 AND \"Deny\" BETWEEN 0 AND 16383 AND ((\"Allow\" | \"Deny\") & 280) = 0");
                    table.ForeignKey(
                        name: "FK_VoiceRoleRules_CommunityRoles_CommunityId_RoleId",
                        columns: x => new { x.CommunityId, x.RoleId },
                        principalTable: "CommunityRoles",
                        principalColumns: new[] { "CommunityId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_CommunityRoles_Grants",
                table: "CommunityRoles",
                sql: "\"Grants\" BETWEEN 0 AND 16383 AND (\"Grants\" & 280) = 0 AND \"Rank\" BETWEEN 0 AND 1000");

            migrationBuilder.CreateIndex(
                name: "IX_Communities_Id_VoiceCategoryId",
                table: "Communities",
                columns: new[] { "Id", "VoiceCategoryId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_ChannelRoleRules_Bits",
                table: "ChannelRoleRules",
                sql: "\"Allow\" BETWEEN 0 AND 16383 AND \"Deny\" BETWEEN 0 AND 16383 AND ((\"Allow\" | \"Deny\") & 280) = 0");

            migrationBuilder.CreateIndex(
                name: "IX_ChannelEvents_MessageId_ChannelId",
                table: "ChannelEvents",
                columns: new[] { "MessageId", "ChannelId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_CategoryRoleRules_Bits",
                table: "CategoryRoleRules",
                sql: "\"Allow\" BETWEEN 0 AND 16383 AND \"Deny\" BETWEEN 0 AND 16383 AND ((\"Allow\" | \"Deny\") & 280) = 0");

            migrationBuilder.CreateIndex(
                name: "IX_AuditEntries_ActorId",
                table: "AuditEntries",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_AuditEntries_CommunityId_CreatedAt_Id",
                table: "AuditEntries",
                columns: new[] { "CommunityId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_MessageCommands_ActorId",
                table: "MessageCommands",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_MessageCommands_MessageId_ChannelId",
                table: "MessageCommands",
                columns: new[] { "MessageId", "ChannelId" });

            migrationBuilder.AddForeignKey(
                name: "FK_ChannelEvents_Messages_MessageId_ChannelId",
                table: "ChannelEvents",
                columns: new[] { "MessageId", "ChannelId" },
                principalTable: "Messages",
                principalColumns: new[] { "Id", "ChannelId" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Communities_Categories_Id_VoiceCategoryId",
                table: "Communities",
                columns: new[] { "Id", "VoiceCategoryId" },
                principalTable: "Categories",
                principalColumns: new[] { "CommunityId", "Id" },
                onDelete: ReferentialAction.Restrict);
            migrationBuilder.Sql("UPDATE \"CommunityRoles\" SET \"Rank\" = 1 WHERE \"Id\" <> \"CommunityId\"; UPDATE \"CommunityRoles\" SET \"Grants\" = \"Grants\" | 6144 WHERE \"Id\" = \"CommunityId\"; INSERT INTO \"VoiceRoleRules\" (\"CommunityId\", \"RoleId\", \"Allow\", \"Deny\") SELECT \"Id\", \"Id\", 1, 0 FROM \"Communities\"");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ChannelEvents_Messages_MessageId_ChannelId",
                table: "ChannelEvents");

            migrationBuilder.DropForeignKey(
                name: "FK_Communities_Categories_Id_VoiceCategoryId",
                table: "Communities");

            migrationBuilder.DropTable(
                name: "AuditEntries");

            migrationBuilder.DropTable(
                name: "MessageCommands");

            migrationBuilder.DropTable(
                name: "VoiceRoleRules");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_Messages_Id_ChannelId",
                table: "Messages");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CommunityRoles_Grants",
                table: "CommunityRoles");

            migrationBuilder.DropIndex(
                name: "IX_Communities_Id_VoiceCategoryId",
                table: "Communities");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ChannelRoleRules_Bits",
                table: "ChannelRoleRules");

            migrationBuilder.DropIndex(
                name: "IX_ChannelEvents_MessageId_ChannelId",
                table: "ChannelEvents");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CategoryRoleRules_Bits",
                table: "CategoryRoleRules");

            migrationBuilder.DropColumn(
                name: "CanSpeak",
                table: "VoiceLeases");

            migrationBuilder.DropColumn(
                name: "Deleted",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "OriginalContentHash",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "Rank",
                table: "CommunityRoles");

            migrationBuilder.DropColumn(
                name: "VoiceCategoryId",
                table: "Communities");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "ChannelEvents");

            migrationBuilder.AddUniqueConstraint(
                name: "AK_Messages_Id_ChannelId_Sequence",
                table: "Messages",
                columns: new[] { "Id", "ChannelId", "Sequence" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_CommunityRoles_Grants",
                table: "CommunityRoles",
                sql: "\"Grants\" BETWEEN 0 AND 3");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ChannelRoleRules_Bits",
                table: "ChannelRoleRules",
                sql: "\"Allow\" BETWEEN 0 AND 3 AND \"Deny\" BETWEEN 0 AND 3");

            migrationBuilder.CreateIndex(
                name: "IX_ChannelEvents_MessageId_ChannelId_Sequence",
                table: "ChannelEvents",
                columns: new[] { "MessageId", "ChannelId", "Sequence" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_CategoryRoleRules_Bits",
                table: "CategoryRoleRules",
                sql: "\"Allow\" BETWEEN 0 AND 3 AND \"Deny\" BETWEEN 0 AND 3");

            migrationBuilder.AddForeignKey(
                name: "FK_ChannelEvents_Messages_MessageId_ChannelId_Sequence",
                table: "ChannelEvents",
                columns: new[] { "MessageId", "ChannelId", "Sequence" },
                principalTable: "Messages",
                principalColumns: new[] { "Id", "ChannelId", "Sequence" },
                onDelete: ReferentialAction.Restrict);
        }
    }
}
