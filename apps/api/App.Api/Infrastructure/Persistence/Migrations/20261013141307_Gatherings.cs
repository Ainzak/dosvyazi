using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Gatherings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Gatherings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganizerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    Game = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    LocalStart = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    TimeZoneId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    StartAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    CoverId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Gatherings", x => x.Id);
                    table.UniqueConstraint("AK_Gatherings_CommunityId_Id", x => new { x.CommunityId, x.Id });
                    table.CheckConstraint("CK_Gatherings_State", "\"Revision\" > 0 AND \"Version\" > 0 AND \"Status\" IN ('Scheduled','Cancelled','Completed')");
                    table.ForeignKey(
                        name: "FK_Gatherings_AspNetUsers_OrganizerId",
                        column: x => x.OrganizerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Gatherings_Communities_CommunityId",
                        column: x => x.CommunityId,
                        principalTable: "Communities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GatheringCommands",
                columns: table => new
                {
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    GatheringId = table.Column<Guid>(type: "uuid", nullable: false),
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GatheringCommands", x => new { x.CommunityId, x.ActorId, x.ClientRequestId });
                    table.ForeignKey(
                        name: "FK_GatheringCommands_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GatheringCommands_Gatherings_CommunityId_GatheringId",
                        columns: x => new { x.CommunityId, x.GatheringId },
                        principalTable: "Gatherings",
                        principalColumns: new[] { "CommunityId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GatheringComments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GatheringId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false),
                    Text = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GatheringComments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GatheringComments_AspNetUsers_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GatheringComments_Gatherings_GatheringId",
                        column: x => x.GatheringId,
                        principalTable: "Gatherings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GatheringCovers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GatheringId = table.Column<Guid>(type: "uuid", nullable: false),
                    ContentType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Retired = table.Column<bool>(type: "boolean", nullable: false),
                    Purged = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GatheringCovers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GatheringCovers_Gatherings_GatheringId",
                        column: x => x.GatheringId,
                        principalTable: "Gatherings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GatheringEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GatheringId = table.Column<Guid>(type: "uuid", nullable: false),
                    CommunityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    RemovedUsersJson = table.Column<string>(type: "text", nullable: false),
                    PublishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GatheringEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GatheringEvents_Gatherings_CommunityId_GatheringId",
                        columns: x => new { x.CommunityId, x.GatheringId },
                        principalTable: "Gatherings",
                        principalColumns: new[] { "CommunityId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GatheringInvites",
                columns: table => new
                {
                    GatheringId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    State = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GatheringInvites", x => new { x.GatheringId, x.UserId });
                    table.CheckConstraint("CK_GatheringInvites_State", "\"State\" IN ('Pending','Accepted','Declined','NeedsClarification')");
                    table.ForeignKey(
                        name: "FK_GatheringInvites_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GatheringInvites_Gatherings_GatheringId",
                        column: x => x.GatheringId,
                        principalTable: "Gatherings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GatheringNotices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GatheringId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    Seen = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GatheringNotices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GatheringNotices_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GatheringNotices_Gatherings_GatheringId",
                        column: x => x.GatheringId,
                        principalTable: "Gatherings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GatheringRevisions",
                columns: table => new
                {
                    GatheringId = table.Column<Guid>(type: "uuid", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    PlanJson = table.Column<string>(type: "text", nullable: false),
                    ResponsesJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GatheringRevisions", x => new { x.GatheringId, x.Revision });
                    table.ForeignKey(
                        name: "FK_GatheringRevisions_Gatherings_GatheringId",
                        column: x => x.GatheringId,
                        principalTable: "Gatherings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GatheringCommands_ActorId",
                table: "GatheringCommands",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_GatheringCommands_CommunityId_GatheringId",
                table: "GatheringCommands",
                columns: new[] { "CommunityId", "GatheringId" });

            migrationBuilder.CreateIndex(
                name: "IX_GatheringComments_AuthorId",
                table: "GatheringComments",
                column: "AuthorId");

            migrationBuilder.CreateIndex(
                name: "IX_GatheringComments_GatheringId_CreatedAt_Id",
                table: "GatheringComments",
                columns: new[] { "GatheringId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_GatheringComments_GatheringId_Sequence",
                table: "GatheringComments",
                columns: new[] { "GatheringId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GatheringCovers_GatheringId",
                table: "GatheringCovers",
                column: "GatheringId");

            migrationBuilder.CreateIndex(
                name: "IX_GatheringEvents_CommunityId_GatheringId",
                table: "GatheringEvents",
                columns: new[] { "CommunityId", "GatheringId" });

            migrationBuilder.CreateIndex(
                name: "IX_GatheringEvents_PublishedAt",
                table: "GatheringEvents",
                column: "PublishedAt",
                filter: "\"PublishedAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_GatheringInvites_UserId",
                table: "GatheringInvites",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_GatheringNotices_GatheringId",
                table: "GatheringNotices",
                column: "GatheringId");

            migrationBuilder.CreateIndex(
                name: "IX_GatheringNotices_UserId_CreatedAt",
                table: "GatheringNotices",
                columns: new[] { "UserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Gatherings_CommunityId_CreatedAt_Id",
                table: "Gatherings",
                columns: new[] { "CommunityId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Gatherings_OrganizerId",
                table: "Gatherings",
                column: "OrganizerId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GatheringCommands");

            migrationBuilder.DropTable(
                name: "GatheringComments");

            migrationBuilder.DropTable(
                name: "GatheringCovers");

            migrationBuilder.DropTable(
                name: "GatheringEvents");

            migrationBuilder.DropTable(
                name: "GatheringInvites");

            migrationBuilder.DropTable(
                name: "GatheringNotices");

            migrationBuilder.DropTable(
                name: "GatheringRevisions");

            migrationBuilder.DropTable(
                name: "Gatherings");
        }
    }
}
