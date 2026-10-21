using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace App.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AttachmentPreviews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "PreviewId",
                table: "MessageAttachments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PreviewSize",
                table: "MessageAttachments",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PreviewId",
                table: "DirectAttachments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PreviewSize",
                table: "DirectAttachments",
                type: "integer",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_MessageAttachment_Preview",
                table: "MessageAttachments",
                sql: "(\"PreviewId\" IS NULL AND \"PreviewSize\" IS NULL) OR (\"PreviewId\" IS NOT NULL AND \"PreviewSize\" BETWEEN 1 AND 98304)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_DirectAttachment_Preview",
                table: "DirectAttachments",
                sql: "(\"PreviewId\" IS NULL AND \"PreviewSize\" IS NULL) OR (\"PreviewId\" IS NOT NULL AND \"PreviewSize\" BETWEEN 1 AND 98304)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MessageAttachment_Preview",
                table: "MessageAttachments");

            migrationBuilder.DropCheckConstraint(
                name: "CK_DirectAttachment_Preview",
                table: "DirectAttachments");

            migrationBuilder.DropColumn(
                name: "PreviewId",
                table: "MessageAttachments");

            migrationBuilder.DropColumn(
                name: "PreviewSize",
                table: "MessageAttachments");

            migrationBuilder.DropColumn(
                name: "PreviewId",
                table: "DirectAttachments");

            migrationBuilder.DropColumn(
                name: "PreviewSize",
                table: "DirectAttachments");
        }
    }
}
