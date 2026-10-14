using System.Buffers.Binary;
using System.Text;
using App.Api.Features.Communities;
using App.Api.Features.Messages;

namespace App.IntegrationTests;

public sealed class VoiceMessageMediaTests
{
    [Fact]
    public void PacketDurationOverridesUntrustedMetadataAndFinalizationIsDeterministic()
    {
        var recording = Recording(10, declaredDuration: double.PositiveInfinity);
        var actual = VoiceMessageMedia.Validate(recording);
        Assert.Equal(200, actual.DurationMs);
        Assert.Equal(actual.Bytes, VoiceMessageMedia.Validate(recording).Bytes);
        Assert.Equal(actual.DurationMs, VoiceMessageMedia.Validate(actual.Bytes).DurationMs);
        Assert.True(actual.Bytes.Length > 0);
    }

    [Theory]
    [InlineData(3001, "A_OPUS", 2, 0)]
    [InlineData(2, "V_VP8", 1, 0)]
    [InlineData(2, "A_VORBIS", 2, 0)]
    [InlineData(2, "A_OPUS", 2, 60000)]
    public void LongVideoOtherCodecAndForgedTimestampsAreRejected(int blocks, string codec, int type, int start)
    {
        var exception = Assert.Throws<CommunityFailure>(() => VoiceMessageMedia.Validate(Recording(blocks, codec, type, start)));
        Assert.Equal(422, exception.Status);
    }

    [Fact]
    public void TruncationAndArbitraryBytesFailAsValidationErrors()
    {
        var bytes = Recording(3);
        for (var length = 32; length < bytes.Length; length++)
            Assert.Equal(422, Assert.Throws<CommunityFailure>(() => VoiceMessageMedia.Validate(bytes[..length])).Status);
        Assert.Equal(413, Assert.Throws<CommunityFailure>(() => VoiceMessageMedia.Validate(new byte[VoiceMessageMedia.MaxBytes + 1])).Status);
        var random = new Random(73);
        for (var attempt = 0; attempt < 100; attempt++)
        {
            var data = new byte[256]; random.NextBytes(data);
            var error = Assert.Throws<CommunityFailure>(() => VoiceMessageMedia.Validate(data)); Assert.Equal(422, error.Status);
        }
    }

    // Structural test packets, not a claim of audible decoding. Real MediaRecorder/decoder tests run in Chromium.
    internal static byte[] Recording(int count, string codec = "A_OPUS", int type = 2, int start = 0, double declaredDuration = 1)
    {
        var opus = new byte[19]; "OpusHead"u8.CopyTo(opus); opus[8] = 1; opus[9] = 1;
        var frequency = new byte[4]; BinaryPrimitives.WriteInt32BigEndian(frequency, BitConverter.SingleToInt32Bits(48000));
        var duration = new byte[8]; BinaryPrimitives.WriteInt64BigEndian(duration, BitConverter.DoubleToInt64Bits(declaredDuration));
        var track = E(0xae, Join(E(0xd7, [1]), E(0x83, [(byte)type]), E(0x86, Encoding.ASCII.GetBytes(codec)), E(0x63a2, opus), E(0xe1, Join(E(0xb5, frequency), E(0x9f, [1])))));
        var clusters = new List<byte[]>();
        for (var index = 0; index < count; index++)
        {
            var timestamp = new byte[4]; BinaryPrimitives.WriteInt32BigEndian(timestamp, start + index * 20);
            clusters.Add(E(0x1f43b675, Join(E(0xe7, timestamp), E(0xa3, [0x81, 0, 0, 0x80, 0xf8, 0]))));
        }
        return Join(E(0x1a45dfa3, E(0x4282, "webm"u8.ToArray())), E(0x18538067, Join(E(0x1549a966, E(0x4489, duration)), E(0x1654ae6b, track), Join(clusters.ToArray()))));
    }
    private static byte[] Join(params byte[][] parts) => parts.SelectMany(part => part).ToArray();
    private static byte[] E(uint id, byte[] payload)
    {
        var identifier = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(identifier, id);
        var length = new byte[8]; BinaryPrimitives.WriteUInt64BigEndian(length, (uint)payload.Length | (1UL << 56));
        return Join(identifier.SkipWhile(value => value == 0).ToArray(), length, payload);
    }
}
