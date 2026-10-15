using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class StickerPacks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MessageAttachments_Media",
                table: "MessageAttachments");

            migrationBuilder.DropCheckConstraint(
                name: "CK_DirectAttachments_Media",
                table: "DirectAttachments");

            migrationBuilder.AddColumn<Guid>(
                name: "SourceStickerId",
                table: "MessageAttachments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StickerPackName",
                table: "MessageAttachments",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SourceStickerId",
                table: "DirectAttachments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StickerPackName",
                table: "DirectAttachments",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "StickerPacks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    BuiltIn = table.Column<bool>(type: "boolean", nullable: false),
                    Name = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Title = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StickerPacks", x => x.Id);
                    table.CheckConstraint("CK_StickerPacks_Owner", "(\"BuiltIn\" AND \"OwnerId\" IS NULL) OR (NOT \"BuiltIn\" AND \"OwnerId\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_StickerPacks_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SavedStickerPacks",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    PackId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SavedStickerPacks", x => new { x.UserId, x.PackId });
                    table.ForeignKey(
                        name: "FK_SavedStickerPacks_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SavedStickerPacks_StickerPacks_PackId",
                        column: x => x.PackId,
                        principalTable: "StickerPacks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StickerAssets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PackId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    Label = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Filename = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false),
                    Purged = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StickerAssets", x => x.Id);
                    table.CheckConstraint("CK_StickerAssets_Media", "\"Size\" BETWEEN 1 AND 1048576 AND \"ContentType\" IN ('image/png', 'image/gif')");
                    table.ForeignKey(
                        name: "FK_StickerAssets_StickerPacks_PackId",
                        column: x => x.PackId,
                        principalTable: "StickerPacks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MessageAttachments_SourceStickerId",
                table: "MessageAttachments",
                column: "SourceStickerId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MessageAttachments_Media",
                table: "MessageAttachments",
                sql: "(\"Kind\" = 'File' AND \"ContentType\" IS NULL AND \"DurationMs\" IS NULL) OR (\"Kind\" = 'Voice' AND \"ContentType\" IS NOT NULL AND \"ContentType\" = 'audio/webm;codecs=opus' AND \"DurationMs\" IS NOT NULL AND \"DurationMs\" BETWEEN 1 AND 60000 AND \"Size\" <= 2097152) OR (\"Kind\" = 'Sticker' AND \"ContentType\" IS NOT NULL AND \"ContentType\" IN ('image/png', 'image/gif') AND \"DurationMs\" IS NULL AND \"SourceStickerId\" IS NOT NULL AND \"StickerPackName\" IS NOT NULL AND \"Size\" <= 1048576)");

            migrationBuilder.CreateIndex(
                name: "IX_DirectAttachments_SourceStickerId",
                table: "DirectAttachments",
                column: "SourceStickerId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_DirectAttachments_Media",
                table: "DirectAttachments",
                sql: "(\"Kind\" = 'File' AND \"ContentType\" IS NULL AND \"DurationMs\" IS NULL) OR (\"Kind\" = 'Voice' AND \"ContentType\" = 'audio/webm;codecs=opus' AND \"ContentType\" IS NOT NULL AND \"DurationMs\" IS NOT NULL AND \"DurationMs\" BETWEEN 1 AND 60000 AND \"Size\" <= 2097152) OR (\"Kind\" = 'Sticker' AND \"ContentType\" IS NOT NULL AND \"ContentType\" IN ('image/png', 'image/gif') AND \"DurationMs\" IS NULL AND \"SourceStickerId\" IS NOT NULL AND \"StickerPackName\" IS NOT NULL AND \"Size\" <= 1048576)");

            migrationBuilder.CreateIndex(
                name: "IX_SavedStickerPacks_PackId",
                table: "SavedStickerPacks",
                column: "PackId");

            migrationBuilder.CreateIndex(
                name: "IX_StickerAssets_PackId_ClientRequestId",
                table: "StickerAssets",
                columns: new[] { "PackId", "ClientRequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StickerPacks_Name",
                table: "StickerPacks",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StickerPacks_OwnerId_ClientRequestId",
                table: "StickerPacks",
                columns: new[] { "OwnerId", "ClientRequestId" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_DirectAttachments_StickerAssets_SourceStickerId",
                table: "DirectAttachments",
                column: "SourceStickerId",
                principalTable: "StickerAssets",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_MessageAttachments_StickerAssets_SourceStickerId",
                table: "MessageAttachments",
                column: "SourceStickerId",
                principalTable: "StickerAssets",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DirectAttachments_StickerAssets_SourceStickerId",
                table: "DirectAttachments");

            migrationBuilder.DropForeignKey(
                name: "FK_MessageAttachments_StickerAssets_SourceStickerId",
                table: "MessageAttachments");

            migrationBuilder.DropTable(
                name: "SavedStickerPacks");

            migrationBuilder.DropTable(
                name: "StickerAssets");

            migrationBuilder.DropTable(
                name: "StickerPacks");

            migrationBuilder.DropIndex(
                name: "IX_MessageAttachments_SourceStickerId",
                table: "MessageAttachments");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MessageAttachments_Media",
                table: "MessageAttachments");

            migrationBuilder.DropIndex(
                name: "IX_DirectAttachments_SourceStickerId",
                table: "DirectAttachments");

            migrationBuilder.DropCheckConstraint(
                name: "CK_DirectAttachments_Media",
                table: "DirectAttachments");

            migrationBuilder.DropColumn(
                name: "SourceStickerId",
                table: "MessageAttachments");

            migrationBuilder.DropColumn(
                name: "StickerPackName",
                table: "MessageAttachments");

            migrationBuilder.DropColumn(
                name: "SourceStickerId",
                table: "DirectAttachments");

            migrationBuilder.DropColumn(
                name: "StickerPackName",
                table: "DirectAttachments");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MessageAttachments_Media",
                table: "MessageAttachments",
                sql: "(\"Kind\" = 'File' AND \"ContentType\" IS NULL AND \"DurationMs\" IS NULL) OR (\"Kind\" = 'Voice' AND \"ContentType\" IS NOT NULL AND \"ContentType\" = 'audio/webm;codecs=opus' AND \"DurationMs\" IS NOT NULL AND \"DurationMs\" BETWEEN 1 AND 60000 AND \"Size\" <= 2097152)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_DirectAttachments_Media",
                table: "DirectAttachments",
                sql: "(\"Kind\" = 'File' AND \"ContentType\" IS NULL AND \"DurationMs\" IS NULL) OR (\"Kind\" = 'Voice' AND \"ContentType\" = 'audio/webm;codecs=opus' AND \"ContentType\" IS NOT NULL AND \"DurationMs\" IS NOT NULL AND \"DurationMs\" BETWEEN 1 AND 60000 AND \"Size\" <= 2097152)");
        }
    }
}
