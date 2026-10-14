using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DirectMessages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DirectConversations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LowerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpperUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DirectConversations", x => x.Id);
                    table.CheckConstraint("CK_DirectConversations_Pair", "\"LowerUserId\" < \"UpperUserId\" AND \"Sequence\" >= 0");
                    table.ForeignKey(
                        name: "FK_DirectConversations_AspNetUsers_LowerUserId",
                        column: x => x.LowerUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DirectConversations_AspNetUsers_UpperUserId",
                        column: x => x.UpperUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "UserBlocks",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    BlockedUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserBlocks", x => new { x.UserId, x.BlockedUserId });
                    table.CheckConstraint("CK_UserBlocks_DifferentUsers", "\"UserId\" <> \"BlockedUserId\"");
                    table.ForeignKey(
                        name: "FK_UserBlocks_AspNetUsers_BlockedUserId",
                        column: x => x.BlockedUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_UserBlocks_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DirectCommands",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DirectCommands", x => new { x.UserId, x.ClientRequestId });
                    table.ForeignKey(
                        name: "FK_DirectCommands_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DirectCommands_DirectConversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "DirectConversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DirectMessages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientMessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    Content = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DirectMessages", x => x.Id);
                    table.CheckConstraint("CK_DirectMessages_Sequence", "\"Sequence\" > 0 AND \"Version\" > 0");
                    table.ForeignKey(
                        name: "FK_DirectMessages_AspNetUsers_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DirectMessages_DirectConversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "DirectConversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DirectReadStates",
                columns: table => new
                {
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DirectReadStates", x => new { x.ConversationId, x.UserId });
                    table.CheckConstraint("CK_DirectReadStates_Sequence", "\"Sequence\" >= 0");
                    table.ForeignKey(
                        name: "FK_DirectReadStates_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DirectReadStates_DirectConversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "DirectConversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DirectAttachments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    Kind = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    DurationMs = table.Column<int>(type: "integer", nullable: true),
                    Purged = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DirectAttachments", x => x.Id);
                    table.CheckConstraint("CK_DirectAttachments_Media", "(\"Kind\" = 'File' AND \"ContentType\" IS NULL AND \"DurationMs\" IS NULL) OR (\"Kind\" = 'Voice' AND \"ContentType\" = 'audio/webm;codecs=opus' AND \"ContentType\" IS NOT NULL AND \"DurationMs\" IS NOT NULL AND \"DurationMs\" BETWEEN 1 AND 60000 AND \"Size\" <= 2097152)");
                    table.CheckConstraint("CK_DirectAttachments_Size", "\"Size\" BETWEEN 1 AND 5242880");
                    table.ForeignKey(
                        name: "FK_DirectAttachments_DirectMessages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "DirectMessages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DirectEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: true),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    PublishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DirectEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DirectEvents_DirectConversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "DirectConversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DirectEvents_DirectMessages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "DirectMessages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DirectAttachments_MessageId",
                table: "DirectAttachments",
                column: "MessageId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DirectCommands_ConversationId",
                table: "DirectCommands",
                column: "ConversationId");

            migrationBuilder.CreateIndex(
                name: "IX_DirectConversations_LowerUserId_UpdatedAt",
                table: "DirectConversations",
                columns: new[] { "LowerUserId", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_DirectConversations_LowerUserId_UpperUserId",
                table: "DirectConversations",
                columns: new[] { "LowerUserId", "UpperUserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DirectConversations_UpperUserId_UpdatedAt",
                table: "DirectConversations",
                columns: new[] { "UpperUserId", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_DirectEvents_ConversationId_Sequence",
                table: "DirectEvents",
                columns: new[] { "ConversationId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DirectEvents_MessageId",
                table: "DirectEvents",
                column: "MessageId");

            migrationBuilder.CreateIndex(
                name: "IX_DirectEvents_PublishedAt",
                table: "DirectEvents",
                column: "PublishedAt",
                filter: "\"PublishedAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DirectMessages_AuthorId_CreatedAt",
                table: "DirectMessages",
                columns: new[] { "AuthorId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_DirectMessages_ConversationId_AuthorId_ClientMessageId",
                table: "DirectMessages",
                columns: new[] { "ConversationId", "AuthorId", "ClientMessageId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DirectMessages_ConversationId_Sequence",
                table: "DirectMessages",
                columns: new[] { "ConversationId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DirectReadStates_UserId",
                table: "DirectReadStates",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_UserBlocks_BlockedUserId",
                table: "UserBlocks",
                column: "BlockedUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DirectAttachments");

            migrationBuilder.DropTable(
                name: "DirectCommands");

            migrationBuilder.DropTable(
                name: "DirectEvents");

            migrationBuilder.DropTable(
                name: "DirectReadStates");

            migrationBuilder.DropTable(
                name: "UserBlocks");

            migrationBuilder.DropTable(
                name: "DirectMessages");

            migrationBuilder.DropTable(
                name: "DirectConversations");
        }
    }
}
