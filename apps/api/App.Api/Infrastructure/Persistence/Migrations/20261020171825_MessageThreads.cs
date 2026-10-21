using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MessageThreads : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_TextChannels_CommunityId_Name",
                table: "TextChannels");

            migrationBuilder.AddColumn<long>(
                name: "LastThreadNumber",
                table: "TextChannels",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<Guid>(
                name: "ParentChannelId",
                table: "TextChannels",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "RootMessageId",
                table: "TextChannels",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ThreadArchived",
                table: "TextChannels",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ThreadCreatedAt",
                table: "TextChannels",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ThreadCreatorId",
                table: "TextChannels",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "ThreadSequence",
                table: "TextChannels",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "ThreadVersion",
                table: "TextChannels",
                type: "bigint",
                nullable: false,
                defaultValue: 1L);

            migrationBuilder.CreateTable(
                name: "ThreadCommands",
                columns: table => new
                {
                    ParentChannelId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    ThreadId = table.Column<Guid>(type: "uuid", nullable: false),
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ThreadCommands", x => new { x.ParentChannelId, x.ActorId, x.ClientRequestId });
                    table.ForeignKey(
                        name: "FK_ThreadCommands_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ThreadCommands_TextChannels_ParentChannelId",
                        column: x => x.ParentChannelId,
                        principalTable: "TextChannels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ThreadCommands_TextChannels_ThreadId",
                        column: x => x.ThreadId,
                        principalTable: "TextChannels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TextChannels_CommunityId_Name",
                table: "TextChannels",
                columns: new[] { "CommunityId", "Name" },
                unique: true,
                filter: "\"ParentChannelId\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_TextChannels_CommunityId_ParentChannelId",
                table: "TextChannels",
                columns: new[] { "CommunityId", "ParentChannelId" });

            migrationBuilder.CreateIndex(
                name: "IX_TextChannels_ParentChannelId_RootMessageId",
                table: "TextChannels",
                columns: new[] { "ParentChannelId", "RootMessageId" },
                unique: true,
                filter: "\"ParentChannelId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_TextChannels_ParentChannelId_ThreadSequence",
                table: "TextChannels",
                columns: new[] { "ParentChannelId", "ThreadSequence" },
                unique: true,
                filter: "\"ParentChannelId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_TextChannels_RootMessageId_ParentChannelId",
                table: "TextChannels",
                columns: new[] { "RootMessageId", "ParentChannelId" });

            migrationBuilder.CreateIndex(
                name: "IX_TextChannels_ThreadCreatorId",
                table: "TextChannels",
                column: "ThreadCreatorId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_TextChannels_Thread",
                table: "TextChannels",
                sql: "\"LastThreadNumber\" BETWEEN 0 AND 1000 AND \"ThreadVersion\" > 0 AND ((\"ParentChannelId\" IS NULL AND \"RootMessageId\" IS NULL AND \"ThreadCreatorId\" IS NULL AND \"ThreadCreatedAt\" IS NULL AND \"ThreadSequence\" = 0 AND NOT \"ThreadArchived\") OR (\"ParentChannelId\" IS NOT NULL AND \"ParentChannelId\" <> \"Id\" AND \"RootMessageId\" IS NOT NULL AND \"ThreadCreatorId\" IS NOT NULL AND \"ThreadCreatedAt\" IS NOT NULL AND \"ThreadSequence\" BETWEEN 1 AND 1000 AND \"LastThreadNumber\" = 0 AND \"CategoryId\" IS NULL))");

            migrationBuilder.CreateIndex(
                name: "IX_ThreadCommands_ActorId",
                table: "ThreadCommands",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_ThreadCommands_ThreadId",
                table: "ThreadCommands",
                column: "ThreadId");

            migrationBuilder.AddForeignKey(
                name: "FK_TextChannels_AspNetUsers_ThreadCreatorId",
                table: "TextChannels",
                column: "ThreadCreatorId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_TextChannels_Messages_RootMessageId_ParentChannelId",
                table: "TextChannels",
                columns: new[] { "RootMessageId", "ParentChannelId" },
                principalTable: "Messages",
                principalColumns: new[] { "Id", "ChannelId" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_TextChannels_TextChannels_CommunityId_ParentChannelId",
                table: "TextChannels",
                columns: new[] { "CommunityId", "ParentChannelId" },
                principalTable: "TextChannels",
                principalColumns: new[] { "CommunityId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_TextChannels_AspNetUsers_ThreadCreatorId",
                table: "TextChannels");

            migrationBuilder.DropForeignKey(
                name: "FK_TextChannels_Messages_RootMessageId_ParentChannelId",
                table: "TextChannels");

            migrationBuilder.DropForeignKey(
                name: "FK_TextChannels_TextChannels_CommunityId_ParentChannelId",
                table: "TextChannels");

            migrationBuilder.DropTable(
                name: "ThreadCommands");

            migrationBuilder.DropIndex(
                name: "IX_TextChannels_CommunityId_Name",
                table: "TextChannels");

            migrationBuilder.DropIndex(
                name: "IX_TextChannels_CommunityId_ParentChannelId",
                table: "TextChannels");

            migrationBuilder.DropIndex(
                name: "IX_TextChannels_ParentChannelId_RootMessageId",
                table: "TextChannels");

            migrationBuilder.DropIndex(
                name: "IX_TextChannels_ParentChannelId_ThreadSequence",
                table: "TextChannels");

            migrationBuilder.DropIndex(
                name: "IX_TextChannels_RootMessageId_ParentChannelId",
                table: "TextChannels");

            migrationBuilder.DropIndex(
                name: "IX_TextChannels_ThreadCreatorId",
                table: "TextChannels");

            migrationBuilder.DropCheckConstraint(
                name: "CK_TextChannels_Thread",
                table: "TextChannels");

            migrationBuilder.DropColumn(
                name: "LastThreadNumber",
                table: "TextChannels");

            migrationBuilder.DropColumn(
                name: "ParentChannelId",
                table: "TextChannels");

            migrationBuilder.DropColumn(
                name: "RootMessageId",
                table: "TextChannels");

            migrationBuilder.DropColumn(
                name: "ThreadArchived",
                table: "TextChannels");

            migrationBuilder.DropColumn(
                name: "ThreadCreatedAt",
                table: "TextChannels");

            migrationBuilder.DropColumn(
                name: "ThreadCreatorId",
                table: "TextChannels");

            migrationBuilder.DropColumn(
                name: "ThreadSequence",
                table: "TextChannels");

            migrationBuilder.DropColumn(
                name: "ThreadVersion",
                table: "TextChannels");

            migrationBuilder.CreateIndex(
                name: "IX_TextChannels_CommunityId_Name",
                table: "TextChannels",
                columns: new[] { "CommunityId", "Name" },
                unique: true);
        }
    }
}
