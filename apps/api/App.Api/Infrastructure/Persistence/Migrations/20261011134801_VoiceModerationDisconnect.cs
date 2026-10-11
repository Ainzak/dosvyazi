using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class VoiceModerationDisconnect : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "DisconnectedByModerator",
                table: "VoiceLeases",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DisconnectedByModerator",
                table: "VoiceLeases");
        }
    }
}
