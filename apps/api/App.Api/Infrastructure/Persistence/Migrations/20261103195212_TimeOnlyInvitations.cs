using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class TimeOnlyInvitations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_CommunityInvites_Limits",
                table: "CommunityInvites");

            migrationBuilder.AlterColumn<int>(
                name: "MaxUses",
                table: "CommunityInvites",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CommunityInvites_Limits",
                table: "CommunityInvites",
                sql: "\"Uses\" >= 0 AND (\"MaxUses\" IS NULL OR (\"Uses\" <= \"MaxUses\" AND \"MaxUses\" BETWEEN 1 AND 100)) AND \"LifetimeHours\" BETWEEN 1 AND 168");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
            => throw new NotSupportedException("Time-only invitations cannot be safely converted to bounded invitations. Restore a reviewed matching backup instead.");
    }
}
