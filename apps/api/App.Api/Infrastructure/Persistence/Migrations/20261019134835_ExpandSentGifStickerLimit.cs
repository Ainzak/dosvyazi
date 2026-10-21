using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ExpandSentGifStickerLimit : Migration
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

            migrationBuilder.AddCheckConstraint(
                name: "CK_MessageAttachments_Media",
                table: "MessageAttachments",
                sql: "(\"Kind\" = 'File' AND \"ContentType\" IS NULL AND \"DurationMs\" IS NULL) OR (\"Kind\" = 'Voice' AND \"ContentType\" IS NOT NULL AND \"ContentType\" = 'audio/webm;codecs=opus' AND \"DurationMs\" IS NOT NULL AND \"DurationMs\" BETWEEN 1 AND 60000 AND \"Size\" <= 2097152) OR (\"Kind\" = 'Sticker' AND \"ContentType\" IS NOT NULL AND \"ContentType\" IN ('image/png', 'image/gif') AND \"DurationMs\" IS NULL AND \"SourceStickerId\" IS NOT NULL AND \"StickerPackName\" IS NOT NULL AND ((\"ContentType\" = 'image/png' AND \"Size\" <= 1048576) OR (\"ContentType\" = 'image/gif' AND \"Size\" <= 3145728)))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_DirectAttachments_Media",
                table: "DirectAttachments",
                sql: "(\"Kind\" = 'File' AND \"ContentType\" IS NULL AND \"DurationMs\" IS NULL) OR (\"Kind\" = 'Voice' AND \"ContentType\" = 'audio/webm;codecs=opus' AND \"ContentType\" IS NOT NULL AND \"DurationMs\" IS NOT NULL AND \"DurationMs\" BETWEEN 1 AND 60000 AND \"Size\" <= 2097152) OR (\"Kind\" = 'Sticker' AND \"ContentType\" IS NOT NULL AND \"ContentType\" IN ('image/png', 'image/gif') AND \"DurationMs\" IS NULL AND \"SourceStickerId\" IS NOT NULL AND \"StickerPackName\" IS NOT NULL AND ((\"ContentType\" = 'image/png' AND \"Size\" <= 1048576) OR (\"ContentType\" = 'image/gif' AND \"Size\" <= 3145728)))");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MessageAttachments_Media",
                table: "MessageAttachments");

            migrationBuilder.DropCheckConstraint(
                name: "CK_DirectAttachments_Media",
                table: "DirectAttachments");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MessageAttachments_Media",
                table: "MessageAttachments",
                sql: "(\"Kind\" = 'File' AND \"ContentType\" IS NULL AND \"DurationMs\" IS NULL) OR (\"Kind\" = 'Voice' AND \"ContentType\" IS NOT NULL AND \"ContentType\" = 'audio/webm;codecs=opus' AND \"DurationMs\" IS NOT NULL AND \"DurationMs\" BETWEEN 1 AND 60000 AND \"Size\" <= 2097152) OR (\"Kind\" = 'Sticker' AND \"ContentType\" IS NOT NULL AND \"ContentType\" IN ('image/png', 'image/gif') AND \"DurationMs\" IS NULL AND \"SourceStickerId\" IS NOT NULL AND \"StickerPackName\" IS NOT NULL AND \"Size\" <= 1048576)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_DirectAttachments_Media",
                table: "DirectAttachments",
                sql: "(\"Kind\" = 'File' AND \"ContentType\" IS NULL AND \"DurationMs\" IS NULL) OR (\"Kind\" = 'Voice' AND \"ContentType\" = 'audio/webm;codecs=opus' AND \"ContentType\" IS NOT NULL AND \"DurationMs\" IS NOT NULL AND \"DurationMs\" BETWEEN 1 AND 60000 AND \"Size\" <= 2097152) OR (\"Kind\" = 'Sticker' AND \"ContentType\" IS NOT NULL AND \"ContentType\" IN ('image/png', 'image/gif') AND \"DurationMs\" IS NULL AND \"SourceStickerId\" IS NOT NULL AND \"StickerPackName\" IS NOT NULL AND \"Size\" <= 1048576)");
        }
    }
}
