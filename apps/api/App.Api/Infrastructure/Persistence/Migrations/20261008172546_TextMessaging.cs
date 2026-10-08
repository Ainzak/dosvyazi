using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class TextMessaging : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "LastSequence",
                table: "TextChannels",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "Messages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ChannelId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientMessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false),
                    Content = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Messages", x => x.Id);
                    table.UniqueConstraint("AK_Messages_Id_ChannelId_Sequence", x => new { x.Id, x.ChannelId, x.Sequence });
                    table.CheckConstraint("CK_Messages_Sequence", "\"Sequence\" > 0");
                    table.ForeignKey(
                        name: "FK_Messages_AspNetUsers_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Messages_TextChannels_ChannelId",
                        column: x => x.ChannelId,
                        principalTable: "TextChannels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ChannelEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ChannelId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChannelEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ChannelEvents_Messages_MessageId_ChannelId_Sequence",
                        columns: x => new { x.MessageId, x.ChannelId, x.Sequence },
                        principalTable: "Messages",
                        principalColumns: new[] { "Id", "ChannelId", "Sequence" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OutboxEntries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EventId = table.Column<Guid>(type: "uuid", nullable: false),
                    PublishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OutboxEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OutboxEntries_ChannelEvents_EventId",
                        column: x => x.EventId,
                        principalTable: "ChannelEvents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChannelEvents_ChannelId_Sequence",
                table: "ChannelEvents",
                columns: new[] { "ChannelId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChannelEvents_MessageId_ChannelId_Sequence",
                table: "ChannelEvents",
                columns: new[] { "MessageId", "ChannelId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_Messages_AuthorId_ChannelId_ClientMessageId",
                table: "Messages",
                columns: new[] { "AuthorId", "ChannelId", "ClientMessageId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Messages_ChannelId_Sequence",
                table: "Messages",
                columns: new[] { "ChannelId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OutboxEntries_EventId",
                table: "OutboxEntries",
                column: "EventId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OutboxEntries_PublishedAt",
                table: "OutboxEntries",
                column: "PublishedAt",
                filter: "\"PublishedAt\" IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OutboxEntries");

            migrationBuilder.DropTable(
                name: "ChannelEvents");

            migrationBuilder.DropTable(
                name: "Messages");

            migrationBuilder.DropColumn(
                name: "LastSequence",
                table: "TextChannels");
        }
    }
}
