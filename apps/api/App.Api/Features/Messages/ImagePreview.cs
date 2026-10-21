using System.Buffers.Binary;
using System.Security.Cryptography;
using App.Api.Features.Communities;
namespace App.Api.Features.Messages;
public static class ImagePreview
{
    public const int MaxBytes = 96 * 1024;
    // Header bounds only; raster decoding remains in the browser after explicit user action.
    public static bool Bounded(byte[] b, int max)
    {
        if (b.Length >= 33 && b.AsSpan().StartsWith(new byte[] {137,80,78,71,13,10,26,10}) && b.AsSpan(12,4).SequenceEqual("IHDR"u8))
            return BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(16,4)) is > 0 and var w && w <= max && BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(20,4)) is > 0 and var h && h <= max;
        if (b.Length < 4 || b[0] != 255 || b[1] != 216) return false;
        for (var p = 2; p + 4 < b.Length;)
        {
            if (b[p++] != 255) break; while (p < b.Length && b[p] == 255) p++; if (p >= b.Length) break; var marker = b[p++];
            if (marker is 217 or 218) break; if (marker is 1 or >= 208 and <= 215) continue;
            if (p + 2 > b.Length) break; var length = BinaryPrimitives.ReadUInt16BigEndian(b.AsSpan(p,2)); if (length < 2 || p + length > b.Length) break;
            if (marker is 192 or 193 or 194 && length >= 8) return BinaryPrimitives.ReadUInt16BigEndian(b.AsSpan(p+3,2)) is > 0 and var h && h <= max && BinaryPrimitives.ReadUInt16BigEndian(b.AsSpan(p+5,2)) is > 0 and var w && w <= max;
            p += length;
        }
        return false;
    }
    public static async Task<PreparedAttachment> PrepareAsync(IFormFile file, IFormFile? preview, CancellationToken ct)
    {
        var original = await AttachmentStore.PrepareAsync(file, ct); if (preview is null) return original;
        if (!Bounded(original.Bytes, 8192) || preview.Length is < 1 or > MaxBytes || preview.Length >= original.Bytes.Length) throw new CommunityFailure(422, "Use a PNG or JPEG preview up to 96 KiB and 320 by 320 pixels for a raster image.");
        await using var input = preview.OpenReadStream(); using var output = new MemoryStream(); var buffer = new byte[8192]; int read;
        while ((read = await input.ReadAsync(buffer, ct)) > 0) { if (output.Length + read > MaxBytes) throw new CommunityFailure(413, "The image preview is too large."); output.Write(buffer, 0, read); }
        var bytes = output.ToArray(); if (!Bounded(bytes, 320)) throw new CommunityFailure(422, "Use a PNG or JPEG preview up to 96 KiB and 320 by 320 pixels for a raster image.");
        return original with { PreviewBytes = bytes, PreviewHash = Convert.ToHexStringLower(SHA256.HashData(bytes)) };
    }
}
