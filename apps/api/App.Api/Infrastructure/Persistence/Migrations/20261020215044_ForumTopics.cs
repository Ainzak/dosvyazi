using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ForumTopics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_TextChannels_Thread",
                table: "TextChannels");

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "TextChannels",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Text");

            migrationBuilder.Sql("UPDATE \"TextChannels\" SET \"Kind\" = 'MessageThread' WHERE \"ParentChannelId\" IS NOT NULL;");

            migrationBuilder.CreateTable(
                name: "ForumTopicCommands",
                columns: table => new
                {
                    ForumId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    TopicId = table.Column<Guid>(type: "uuid", nullable: false),
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ForumTopicCommands", x => new { x.ForumId, x.ActorId, x.ClientRequestId });
                    table.ForeignKey(
                        name: "FK_ForumTopicCommands_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ForumTopicCommands_TextChannels_ForumId",
                        column: x => x.ForumId,
                        principalTable: "TextChannels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ForumTopicCommands_TextChannels_TopicId",
                        column: x => x.TopicId,
                        principalTable: "TextChannels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_TextChannels_Discussion",
                table: "TextChannels",
                sql: "\"LastThreadNumber\" BETWEEN 0 AND 1000 AND \"ThreadVersion\" > 0 AND ((\"Kind\" IN ('Text', 'Forum') AND \"ParentChannelId\" IS NULL AND \"RootMessageId\" IS NULL AND \"ThreadCreatorId\" IS NULL AND \"ThreadCreatedAt\" IS NULL AND \"ThreadSequence\" = 0 AND NOT \"ThreadArchived\") OR (\"ParentChannelId\" IS NOT NULL AND \"ParentChannelId\" <> \"Id\" AND ((\"Kind\" = 'MessageThread' AND \"RootMessageId\" IS NOT NULL) OR (\"Kind\" = 'ForumTopic' AND \"RootMessageId\" IS NULL)) AND \"ThreadCreatorId\" IS NOT NULL AND \"ThreadCreatedAt\" IS NOT NULL AND \"ThreadSequence\" BETWEEN 1 AND 1000 AND \"LastThreadNumber\" = 0 AND \"CategoryId\" IS NULL))");

            migrationBuilder.CreateIndex(
                name: "IX_ForumTopicCommands_ActorId",
                table: "ForumTopicCommands",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_ForumTopicCommands_TopicId",
                table: "ForumTopicCommands",
                column: "TopicId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ForumTopicCommands");

            migrationBuilder.DropCheckConstraint(
                name: "CK_TextChannels_Discussion",
                table: "TextChannels");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "TextChannels");

            migrationBuilder.AddCheckConstraint(
                name: "CK_TextChannels_Thread",
                table: "TextChannels",
                sql: "\"LastThreadNumber\" BETWEEN 0 AND 1000 AND \"ThreadVersion\" > 0 AND ((\"ParentChannelId\" IS NULL AND \"RootMessageId\" IS NULL AND \"ThreadCreatorId\" IS NULL AND \"ThreadCreatedAt\" IS NULL AND \"ThreadSequence\" = 0 AND NOT \"ThreadArchived\") OR (\"ParentChannelId\" IS NOT NULL AND \"ParentChannelId\" <> \"Id\" AND \"RootMessageId\" IS NOT NULL AND \"ThreadCreatorId\" IS NOT NULL AND \"ThreadCreatedAt\" IS NOT NULL AND \"ThreadSequence\" BETWEEN 1 AND 1000 AND \"LastThreadNumber\" = 0 AND \"CategoryId\" IS NULL))");
        }
    }
}
