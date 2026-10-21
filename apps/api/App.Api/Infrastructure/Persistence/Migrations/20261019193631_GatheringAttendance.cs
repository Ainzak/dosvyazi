using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class GatheringAttendance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Capacity",
                table: "Gatherings",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasSeat",
                table: "GatheringInvites",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "GatheringPolls",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GatheringId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Closed = table.Column<bool>(type: "boolean", nullable: false),
                    SelectedOptionId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GatheringPolls", x => x.Id);
                    table.CheckConstraint("CK_GatheringPoll_Kind", "\"Kind\" IN ('Time','Game') AND \"Revision\" > 0");
                    table.ForeignKey(
                        name: "FK_GatheringPolls_Gatherings_GatheringId",
                        column: x => x.GatheringId,
                        principalTable: "Gatherings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GatheringPollOptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PollId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    Game = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    LocalStart = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    TimeZoneId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    StartAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GatheringPollOptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GatheringPollOptions_GatheringPolls_PollId",
                        column: x => x.PollId,
                        principalTable: "GatheringPolls",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GatheringPollVotes",
                columns: table => new
                {
                    PollId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    Options = table.Column<Guid[]>(type: "uuid[]", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GatheringPollVotes", x => new { x.PollId, x.UserId });
                    table.ForeignKey(
                        name: "FK_GatheringPollVotes_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GatheringPollVotes_GatheringPolls_PollId",
                        column: x => x.PollId,
                        principalTable: "GatheringPolls",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Gathering_Capacity",
                table: "Gatherings",
                sql: "\"Capacity\" IS NULL OR \"Capacity\" BETWEEN 1 AND 51");

            migrationBuilder.CreateIndex(
                name: "IX_GatheringPollOptions_PollId_Position",
                table: "GatheringPollOptions",
                columns: new[] { "PollId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GatheringPolls_GatheringId",
                table: "GatheringPolls",
                column: "GatheringId");

            migrationBuilder.CreateIndex(
                name: "IX_GatheringPollVotes_UserId",
                table: "GatheringPollVotes",
                column: "UserId");
            migrationBuilder.Sql("UPDATE \"GatheringInvites\" SET \"HasSeat\" = TRUE WHERE \"Active\" AND \"State\" = 'Accepted'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GatheringPollOptions");

            migrationBuilder.DropTable(
                name: "GatheringPollVotes");

            migrationBuilder.DropTable(
                name: "GatheringPolls");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Gathering_Capacity",
                table: "Gatherings");

            migrationBuilder.DropColumn(
                name: "Capacity",
                table: "Gatherings");

            migrationBuilder.DropColumn(
                name: "HasSeat",
                table: "GatheringInvites");
        }
    }
}
