using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ExpandGifStickerLimit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_StickerAssets_Media",
                table: "StickerAssets");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StickerAssets_Media",
                table: "StickerAssets",
                sql: "(\"ContentType\" = 'image/png' AND \"Size\" BETWEEN 1 AND 1048576) OR (\"ContentType\" = 'image/gif' AND \"Size\" BETWEEN 1 AND 3145728)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_StickerAssets_Media",
                table: "StickerAssets");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StickerAssets_Media",
                table: "StickerAssets",
                sql: "\"Size\" BETWEEN 1 AND 1048576 AND \"ContentType\" IN ('image/png', 'image/gif')");
        }
    }
}
