using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class VoiceMessages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ContentType",
                table: "MessageAttachments",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DurationMs",
                table: "MessageAttachments",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "MessageAttachments",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "File");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MessageAttachments_Media",
                table: "MessageAttachments",
                sql: "(\"Kind\" = 'File' AND \"ContentType\" IS NULL AND \"DurationMs\" IS NULL) OR (\"Kind\" = 'Voice' AND \"ContentType\" IS NOT NULL AND \"ContentType\" = 'audio/webm;codecs=opus' AND \"DurationMs\" IS NOT NULL AND \"DurationMs\" BETWEEN 1 AND 60000 AND \"Size\" <= 2097152)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MessageAttachments_Media",
                table: "MessageAttachments");

            migrationBuilder.DropColumn(
                name: "ContentType",
                table: "MessageAttachments");

            migrationBuilder.DropColumn(
                name: "DurationMs",
                table: "MessageAttachments");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "MessageAttachments");
        }
    }
}
