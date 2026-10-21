using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class GatheringPreparation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GatheringChecklistItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GatheringId = table.Column<Guid>(type: "uuid", nullable: false),
                    Text = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    AssigneeId = table.Column<Guid>(type: "uuid", nullable: true),
                    Done = table.Column<bool>(type: "boolean", nullable: false),
                    Removed = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GatheringChecklistItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GatheringChecklistItems_AspNetUsers_AssigneeId",
                        column: x => x.AssigneeId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GatheringChecklistItems_Gatherings_GatheringId",
                        column: x => x.GatheringId,
                        principalTable: "Gatherings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GatheringReminders",
                columns: table => new
                {
                    GatheringId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Minutes = table.Column<int>(type: "integer", nullable: true),
                    DueAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeliveredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    NoticeId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GatheringReminders", x => new { x.GatheringId, x.UserId });
                    table.CheckConstraint("CK_GatheringReminder_Values", "\"Version\" > 0 AND \"Revision\" > 0 AND (\"Minutes\" IS NULL OR \"Minutes\" IN (5,15,60,1440))");
                    table.ForeignKey(
                        name: "FK_GatheringReminders_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GatheringReminders_Gatherings_GatheringId",
                        column: x => x.GatheringId,
                        principalTable: "Gatherings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GatheringChecklistItems_AssigneeId",
                table: "GatheringChecklistItems",
                column: "AssigneeId");

            migrationBuilder.CreateIndex(
                name: "IX_GatheringChecklistItems_GatheringId_CreatedAt_Id",
                table: "GatheringChecklistItems",
                columns: new[] { "GatheringId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_GatheringReminders_DueAt",
                table: "GatheringReminders",
                column: "DueAt",
                filter: "\"DueAt\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_GatheringReminders_UserId",
                table: "GatheringReminders",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GatheringChecklistItems");

            migrationBuilder.DropTable(
                name: "GatheringReminders");
        }
    }
}
