using System.Buffers.Binary;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Features.Stickers;

namespace App.IntegrationTests;

public sealed class GifMediaTests
{
    // Original two-frame red/blue synthetic image, generated with Pillow; no external artwork.
    public static byte[] Animated() => Convert.FromBase64String("R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQACgAAACwAAAAAAgACAIEAAP8AAAAAAAAAAAAIBgABCAQQEAA7");
    [Fact]
    public void AcceptsActualAnimationAndRejectsEveryTruncatedPrefix()
    {
        var bytes = Animated(); Assert.Equal((2, 2, 2), GifMedia.Validate(bytes));
        for (var length = 0; length < bytes.Length; length++)
        { var truncated = bytes[..length]; Assert.Throws<CommunityFailure>(() => GifMedia.Validate(truncated)); }
        Assert.Throws<CommunityFailure>(() => GifMedia.Validate([.. bytes, 0]));
        Assert.Throws<CommunityFailure>(() => GifMedia.Validate("<svg onload='alert(1)'/>"u8));
    }
    [Fact]
    public void BoundsCanvasFramesAndStickerDimensionsWithoutTrustingExtensions()
    {
        var bytes = Animated(); BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(6), 0);
        Assert.Throws<CommunityFailure>(() => GifMedia.Validate(bytes));
        bytes = Animated(); BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(6), 2049);
        Assert.Throws<CommunityFailure>(() => GifMedia.Validate(bytes));
        var header = Animated()[..25]; var frame = Convert.FromHexString("2C000000000200020000080600010804101000");
        var many = header.Concat(Enumerable.Range(0, 301).SelectMany(_ => frame)).Append((byte)0x3b).ToArray();
        Assert.Throws<CommunityFailure>(() => GifMedia.Validate(many));
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(6), 2048); BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(8), 2048);
        var costly = header.Concat(Enumerable.Range(0, 16).SelectMany(_ => frame)).Append((byte)0x3b).ToArray();
        Assert.Throws<CommunityFailure>(() => GifMedia.Validate(costly));
        Assert.Equal("image/gif", StickerMedia.Validate(new("test.gif", Animated(), "synthetic")));
        Assert.Throws<CommunityFailure>(() => StickerMedia.Validate(new("test.jpg", Animated(), "synthetic")));
        var png = new byte[24]; "IHDR"u8.CopyTo(png.AsSpan(12)); BinaryPrimitives.WriteUInt32BigEndian(png.AsSpan(16), uint.MaxValue);
        Assert.Throws<CommunityFailure>(() => StickerMedia.Validate(new("test.png", png, "synthetic")));
    }
}
