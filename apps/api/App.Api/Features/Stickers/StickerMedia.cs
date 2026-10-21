using System.Buffers.Binary;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Stickers;

public static class StickerMedia
{
    public const int MaxPngBytes = 1024 * 1024;
    public const int MaxGifBytes = 3 * 1024 * 1024;
    public static int Limit(string filename) => Path.GetExtension(filename).Equals(".gif", StringComparison.OrdinalIgnoreCase) ? MaxGifBytes : MaxPngBytes;
    public static void ValidateSize(string filename, long size)
    {
        if (size < 1 || size > Limit(filename)) throw new CommunityFailure(413, "Choose a PNG sticker up to 1 MiB or a GIF sticker up to 3 MiB.");
    }
    public static string Validate(PreparedAttachment file)
    {
        ValidateSize(file.Name, file.Bytes.Length);
        int width, height; string type;
        if (Path.GetExtension(file.Name).Equals(".png", StringComparison.OrdinalIgnoreCase) && file.Bytes.Length >= 24 && file.Bytes.AsSpan(12, 4).SequenceEqual("IHDR"u8))
        {
            var w = BinaryPrimitives.ReadUInt32BigEndian(file.Bytes.AsSpan(16)); var h = BinaryPrimitives.ReadUInt32BigEndian(file.Bytes.AsSpan(20));
            if (w > 512 || h > 512) throw new CommunityFailure(422, "Use sticker dimensions up to 512 by 512 pixels.");
            width = (int)w; height = (int)h; type = "image/png";
        }
        else if (Path.GetExtension(file.Name).Equals(".gif", StringComparison.OrdinalIgnoreCase))
        { var gif = GifMedia.Validate(file.Bytes); width = gif.Width; height = gif.Height; type = "image/gif"; }
        else throw new CommunityFailure(422, "Stickers support PNG and animated GIF only.");
        if (width is < 1 or > 512 || height is < 1 or > 512) throw new CommunityFailure(422, "Use sticker dimensions up to 512 by 512 pixels.");
        return type;
    }

    public static async Task<PreparedAttachment> PrepareAsync(AppDbContext db, AttachmentStore files, Guid id, CancellationToken ct)
    {
        var asset = await db.StickerAssets.AsNoTracking().Include(s => s.Pack).SingleOrDefaultAsync(s => s.Id == id && !s.Deleted && !s.Purged && !s.Pack.Deleted, ct)
            ?? throw new CommunityFailure(404, "Sticker or pack is unavailable.");
        await using var stream = files.Open(asset.Id);
        var limit = asset.ContentType == "image/gif" ? MaxGifBytes : MaxPngBytes;
        if (stream.Length != asset.Size || stream.Length > limit) throw new CommunityFailure(503, "Sticker storage is unavailable.");
        using var output = new MemoryStream(); await stream.CopyToAsync(output, ct);
        if (output.Length != asset.Size || output.Length > limit) throw new CommunityFailure(503, "Sticker storage is unavailable.");
        return new(asset.Filename, output.ToArray(), asset.Hash, "Sticker", asset.ContentType, SourceStickerId: asset.Id, StickerPackName: asset.Pack.Name);
    }
}
