using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class TextAccessPolicy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CategoryId",
                table: "TextChannels",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_TextChannels_CommunityId_Id",
                table: "TextChannels",
                columns: new[] { "CommunityId", "Id" });

            migrationBuilder.CreateTable(
                name: "AccessChanges",
                columns: table => new
                {
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ResultVersion = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccessChanges", x => new { x.CommunityId, x.ClientRequestId });
                    table.ForeignKey(
                        name: "FK_AccessChanges_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AccessChanges_Communities_CommunityId",
                        column: x => x.CommunityId,
                        principalTable: "Communities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Categories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Categories", x => x.Id);
                    table.UniqueConstraint("AK_Categories_CommunityId_Id", x => new { x.CommunityId, x.Id });
                    table.ForeignKey(
                        name: "FK_Categories_Communities_CommunityId",
                        column: x => x.CommunityId,
                        principalTable: "Communities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CommunityRoles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Grants = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommunityRoles", x => x.Id);
                    table.UniqueConstraint("AK_CommunityRoles_CommunityId_Id", x => new { x.CommunityId, x.Id });
                    table.CheckConstraint("CK_CommunityRoles_Grants", "\"Grants\" BETWEEN 0 AND 3");
                    table.ForeignKey(
                        name: "FK_CommunityRoles_Communities_CommunityId",
                        column: x => x.CommunityId,
                        principalTable: "Communities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CategoryRoleRules",
                columns: table => new
                {
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Allow = table.Column<int>(type: "integer", nullable: false),
                    Deny = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CategoryRoleRules", x => new { x.CommunityId, x.CategoryId, x.RoleId });
                    table.CheckConstraint("CK_CategoryRoleRules_Bits", "\"Allow\" BETWEEN 0 AND 3 AND \"Deny\" BETWEEN 0 AND 3");
                    table.ForeignKey(
                        name: "FK_CategoryRoleRules_Categories_CommunityId_CategoryId",
                        columns: x => new { x.CommunityId, x.CategoryId },
                        principalTable: "Categories",
                        principalColumns: new[] { "CommunityId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CategoryRoleRules_CommunityRoles_CommunityId_RoleId",
                        columns: x => new { x.CommunityId, x.RoleId },
                        principalTable: "CommunityRoles",
                        principalColumns: new[] { "CommunityId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ChannelRoleRules",
                columns: table => new
                {
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    ChannelId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Allow = table.Column<int>(type: "integer", nullable: false),
                    Deny = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChannelRoleRules", x => new { x.CommunityId, x.ChannelId, x.RoleId });
                    table.CheckConstraint("CK_ChannelRoleRules_Bits", "\"Allow\" BETWEEN 0 AND 3 AND \"Deny\" BETWEEN 0 AND 3");
                    table.ForeignKey(
                        name: "FK_ChannelRoleRules_CommunityRoles_CommunityId_RoleId",
                        columns: x => new { x.CommunityId, x.RoleId },
                        principalTable: "CommunityRoles",
                        principalColumns: new[] { "CommunityId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ChannelRoleRules_TextChannels_CommunityId_ChannelId",
                        columns: x => new { x.CommunityId, x.ChannelId },
                        principalTable: "TextChannels",
                        principalColumns: new[] { "CommunityId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MemberRoles",
                columns: table => new
                {
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoleId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MemberRoles", x => new { x.CommunityId, x.UserId, x.RoleId });
                    table.ForeignKey(
                        name: "FK_MemberRoles_CommunityRoles_CommunityId_RoleId",
                        columns: x => new { x.CommunityId, x.RoleId },
                        principalTable: "CommunityRoles",
                        principalColumns: new[] { "CommunityId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MemberRoles_Memberships_CommunityId_UserId",
                        columns: x => new { x.CommunityId, x.UserId },
                        principalTable: "Memberships",
                        principalColumns: new[] { "CommunityId", "UserId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.Sql("INSERT INTO \"CommunityRoles\" (\"Id\", \"CommunityId\", \"Name\", \"Grants\") SELECT \"Id\", \"Id\", 'everyone', 3 FROM \"Communities\"");

            migrationBuilder.CreateIndex(
                name: "IX_TextChannels_CommunityId_CategoryId",
                table: "TextChannels",
                columns: new[] { "CommunityId", "CategoryId" });

            migrationBuilder.CreateIndex(
                name: "IX_AccessChanges_ActorId",
                table: "AccessChanges",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_CategoryRoleRules_CommunityId_RoleId",
                table: "CategoryRoleRules",
                columns: new[] { "CommunityId", "RoleId" });

            migrationBuilder.CreateIndex(
                name: "IX_ChannelRoleRules_CommunityId_RoleId",
                table: "ChannelRoleRules",
                columns: new[] { "CommunityId", "RoleId" });

            migrationBuilder.CreateIndex(
                name: "IX_MemberRoles_CommunityId_RoleId",
                table: "MemberRoles",
                columns: new[] { "CommunityId", "RoleId" });

            migrationBuilder.AddForeignKey(
                name: "FK_TextChannels_Categories_CommunityId_CategoryId",
                table: "TextChannels",
                columns: new[] { "CommunityId", "CategoryId" },
                principalTable: "Categories",
                principalColumns: new[] { "CommunityId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_TextChannels_Categories_CommunityId_CategoryId",
                table: "TextChannels");

            migrationBuilder.DropTable(
                name: "AccessChanges");

            migrationBuilder.DropTable(
                name: "CategoryRoleRules");

            migrationBuilder.DropTable(
                name: "ChannelRoleRules");

            migrationBuilder.DropTable(
                name: "MemberRoles");

            migrationBuilder.DropTable(
                name: "Categories");

            migrationBuilder.DropTable(
                name: "CommunityRoles");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_TextChannels_CommunityId_Id",
                table: "TextChannels");

            migrationBuilder.DropIndex(
                name: "IX_TextChannels_CommunityId_CategoryId",
                table: "TextChannels");

            migrationBuilder.DropColumn(
                name: "CategoryId",
                table: "TextChannels");
        }
    }
}
