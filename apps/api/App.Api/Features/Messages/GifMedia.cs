using System.Buffers.Binary;
using App.Api.Features.Communities;

namespace App.Api.Features.Messages;

// Bounded GIF block validation, not an LZW decoder. Browsers decode only after explicit viewing.
public static class GifMedia
{
    public static (int Width, int Height, int Frames) Validate(ReadOnlySpan<byte> bytes)
    {
        static CommunityFailure Invalid() => new(422, "Use a complete GIF up to 2048 by 2048 pixels, 300 frames and 64 million canvas pixels across frames.");
        if (bytes.Length < 14 || !(bytes[..6].SequenceEqual("GIF87a"u8) || bytes[..6].SequenceEqual("GIF89a"u8))) throw Invalid();
        var width = BinaryPrimitives.ReadUInt16LittleEndian(bytes[6..]); var height = BinaryPrimitives.ReadUInt16LittleEndian(bytes[8..]);
        if (width is < 1 or > 2048 || height is < 1 or > 2048) throw Invalid();
        var offset = 13; var frames = 0; var global = (bytes[10] & 128) != 0;
        if (global) offset += 3 * (1 << ((bytes[10] & 7) + 1));
        while (offset < bytes.Length)
        {
            var marker = bytes[offset++];
            if (marker == 0x3b)
            {
                if (frames == 0 || offset != bytes.Length) throw Invalid();
                return (width, height, frames);
            }
            if (marker == 0x21)
            {
                if (offset >= bytes.Length) throw Invalid();
                var label = bytes[offset++];
                if (label == 0xf9)
                {
                    if (offset + 6 > bytes.Length || bytes[offset] != 4 || bytes[offset + 5] != 0 || (bytes[offset + 1] & 0xe0) != 0 || ((bytes[offset + 1] >> 2) & 7) > 3) throw Invalid();
                    offset += 6;
                }
                else
                {
                    // Comments and application extensions (including looping) are inert metadata. Plain text is unsupported.
                    if (label is not 0xfe and not 0xff || (label == 0xff && (offset >= bytes.Length || bytes[offset] != 11))) throw Invalid();
                    SkipBlocks(bytes, ref offset);
                }
                continue;
            }
            if (marker != 0x2c || offset + 9 > bytes.Length) throw Invalid();
            var left = BinaryPrimitives.ReadUInt16LittleEndian(bytes[offset..]); var top = BinaryPrimitives.ReadUInt16LittleEndian(bytes[(offset + 2)..]);
            var frameWidth = BinaryPrimitives.ReadUInt16LittleEndian(bytes[(offset + 4)..]); var frameHeight = BinaryPrimitives.ReadUInt16LittleEndian(bytes[(offset + 6)..]);
            var packed = bytes[offset + 8]; offset += 9;
            if (frameWidth == 0 || frameHeight == 0 || left + frameWidth > width || top + frameHeight > height || (packed & 24) != 0 || ++frames > 300 || (long)width * height * frames > 64_000_000) throw Invalid();
            if ((packed & 128) != 0) offset += 3 * (1 << ((packed & 7) + 1)); else if (!global) throw Invalid();
            if (offset >= bytes.Length || bytes[offset++] is < 2 or > 8 || offset >= bytes.Length || bytes[offset] == 0) throw Invalid();
            SkipBlocks(bytes, ref offset);
        }
        throw Invalid();
    }

    private static void SkipBlocks(ReadOnlySpan<byte> bytes, ref int offset)
    {
        while (offset < bytes.Length)
        {
            var size = bytes[offset++]; if (size == 0) return;
            if (offset + size > bytes.Length) break; offset += size;
        }
        throw new CommunityFailure(422, "The GIF contains a truncated data block.");
    }
}
