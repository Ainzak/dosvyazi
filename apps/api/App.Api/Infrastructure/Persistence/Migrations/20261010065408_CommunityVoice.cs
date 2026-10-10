using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CommunityVoice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RetiredVoiceRooms",
                columns: table => new
                {
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    Generation = table.Column<long>(type: "bigint", nullable: false),
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    LastCleanupAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RetiredVoiceRooms", x => new { x.RoomId, x.Generation });
                    table.ForeignKey(
                        name: "FK_RetiredVoiceRooms_Communities_CommunityId",
                        column: x => x.CommunityId,
                        principalTable: "Communities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "VoiceLeases",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthSessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    SecurityStamp = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Generation = table.Column<long>(type: "bigint", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VoiceLeases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VoiceLeases_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_VoiceLeases_Communities_CommunityId",
                        column: x => x.CommunityId,
                        principalTable: "Communities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_VoiceLeases_Sessions_AuthSessionId",
                        column: x => x.AuthSessionId,
                        principalTable: "Sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "VoiceRooms",
                columns: table => new
                {
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Generation = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    OperationId = table.Column<Guid>(type: "uuid", nullable: true),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ControlUnavailable = table.Column<bool>(type: "boolean", nullable: false),
                    NextCheckAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VoiceRooms", x => x.CommunityId);
                    table.CheckConstraint("CK_VoiceRooms_State", "\"Generation\" > 0 AND \"Status\" IN ('Ready', 'Pending')");
                    table.ForeignKey(
                        name: "FK_VoiceRooms_Communities_CommunityId",
                        column: x => x.CommunityId,
                        principalTable: "Communities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "VoiceGrantRequests",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    LeaseId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProtectedToken = table.Column<string>(type: "text", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VoiceGrantRequests", x => new { x.UserId, x.ClientRequestId });
                    table.ForeignKey(
                        name: "FK_VoiceGrantRequests_VoiceLeases_LeaseId",
                        column: x => x.LeaseId,
                        principalTable: "VoiceLeases",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RetiredVoiceRooms_CommunityId",
                table: "RetiredVoiceRooms",
                column: "CommunityId");

            migrationBuilder.CreateIndex(
                name: "IX_VoiceGrantRequests_LeaseId",
                table: "VoiceGrantRequests",
                column: "LeaseId");

            migrationBuilder.CreateIndex(
                name: "IX_VoiceLeases_AuthSessionId",
                table: "VoiceLeases",
                column: "AuthSessionId");

            migrationBuilder.CreateIndex(
                name: "IX_VoiceLeases_CommunityId_Active",
                table: "VoiceLeases",
                columns: new[] { "CommunityId", "Active" });

            migrationBuilder.CreateIndex(
                name: "IX_VoiceLeases_UserId",
                table: "VoiceLeases",
                column: "UserId",
                unique: true,
                filter: "\"Active\"");

            migrationBuilder.CreateIndex(
                name: "IX_VoiceRooms_Id",
                table: "VoiceRooms",
                column: "Id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_VoiceRooms_NextCheckAt",
                table: "VoiceRooms",
                column: "NextCheckAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RetiredVoiceRooms");

            migrationBuilder.DropTable(
                name: "VoiceGrantRequests");

            migrationBuilder.DropTable(
                name: "VoiceRooms");

            migrationBuilder.DropTable(
                name: "VoiceLeases");
        }
    }
}
