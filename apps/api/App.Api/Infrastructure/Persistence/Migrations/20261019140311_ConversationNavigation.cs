using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ConversationNavigation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid[]>(
                name: "MentionUserIds",
                table: "Messages",
                type: "uuid[]",
                nullable: false,
                defaultValue: new Guid[0]);

            migrationBuilder.AddColumn<Guid>(
                name: "ReplyToId",
                table: "Messages",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid[]>(
                name: "MentionUserIds",
                table: "DirectMessages",
                type: "uuid[]",
                nullable: false,
                defaultValue: new Guid[0]);

            migrationBuilder.AddColumn<Guid>(
                name: "ReplyToId",
                table: "DirectMessages",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ConversationPreferences",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    ContainerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Mode = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ConversationPreferences", x => new { x.UserId, x.Kind, x.ContainerId });
                    table.CheckConstraint("CK_ConversationPreference_Kind", "\"Kind\" IN ('channel','direct')");
                    table.CheckConstraint("CK_ConversationPreference_Mode", "\"Mode\" IN ('all','mentions','quiet')");
                    table.ForeignKey(
                        name: "FK_ConversationPreferences_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MessageBookmarks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    ContainerId = table.Column<Guid>(type: "uuid", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Tags = table.Column<string[]>(type: "text[]", nullable: false),
                    Removed = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessageBookmarks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MessageBookmarks_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MessageNotices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    ContainerId = table.Column<Guid>(type: "uuid", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    Mention = table.Column<bool>(type: "boolean", nullable: false),
                    Read = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessageNotices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MessageNotices_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "NavigationCommands",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NavigationCommands", x => new { x.UserId, x.ClientRequestId });
                    table.ForeignKey(
                        name: "FK_NavigationCommands_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MessageBookmarks_UserId_CreatedAt_Id",
                table: "MessageBookmarks",
                columns: new[] { "UserId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_MessageBookmarks_UserId_Kind_MessageId",
                table: "MessageBookmarks",
                columns: new[] { "UserId", "Kind", "MessageId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MessageNotices_UserId_CreatedAt_Id",
                table: "MessageNotices",
                columns: new[] { "UserId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_MessageNotices_UserId_Kind_MessageId",
                table: "MessageNotices",
                columns: new[] { "UserId", "Kind", "MessageId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ConversationPreferences");

            migrationBuilder.DropTable(
                name: "MessageBookmarks");

            migrationBuilder.DropTable(
                name: "MessageNotices");

            migrationBuilder.DropTable(
                name: "NavigationCommands");

            migrationBuilder.DropColumn(
                name: "MentionUserIds",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "ReplyToId",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "MentionUserIds",
                table: "DirectMessages");

            migrationBuilder.DropColumn(
                name: "ReplyToId",
                table: "DirectMessages");
        }
    }
}
