using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DirectCalls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DirectCalls",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    CallerId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipientId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RingUntil = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    EndedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    EndReason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Cleaned = table.Column<bool>(type: "boolean", nullable: false),
                    NextCheckAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AdmissionAttempt = table.Column<Guid>(type: "uuid", nullable: true),
                    AdmissionDeadline = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DirectCalls", x => x.Id);
                    table.CheckConstraint("CK_DirectCalls_Status", "\"Status\" IN ('Ringing','Active','Ended') AND \"CallerId\" <> \"RecipientId\"");
                    table.ForeignKey(
                        name: "FK_DirectCalls_AspNetUsers_CallerId",
                        column: x => x.CallerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DirectCalls_AspNetUsers_RecipientId",
                        column: x => x.RecipientId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DirectCalls_DirectConversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "DirectConversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DirectCallMembers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CallId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    SecurityStamp = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DirectCallMembers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DirectCallMembers_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DirectCallMembers_DirectCalls_CallId",
                        column: x => x.CallId,
                        principalTable: "DirectCalls",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DirectCallMembers_Sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "Sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DirectCallMembers_CallId_UserId",
                table: "DirectCallMembers",
                columns: new[] { "CallId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DirectCallMembers_SessionId",
                table: "DirectCallMembers",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_DirectCallMembers_UserId",
                table: "DirectCallMembers",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_DirectCalls_CallerId_ClientRequestId",
                table: "DirectCalls",
                columns: new[] { "CallerId", "ClientRequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DirectCalls_CallerId_Status",
                table: "DirectCalls",
                columns: new[] { "CallerId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_DirectCalls_Cleaned_NextCheckAt",
                table: "DirectCalls",
                columns: new[] { "Cleaned", "NextCheckAt" });

            migrationBuilder.CreateIndex(
                name: "IX_DirectCalls_ConversationId",
                table: "DirectCalls",
                column: "ConversationId");

            migrationBuilder.CreateIndex(
                name: "IX_DirectCalls_RecipientId_Status",
                table: "DirectCalls",
                columns: new[] { "RecipientId", "Status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
            => throw new NotSupportedException("Call records must be preserved. Restore a reviewed matching backup instead.");
    }
}
