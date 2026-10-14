using System.Buffers.Binary;
using App.Api.Features.Communities;

namespace App.Api.Features.Messages;

// A bounded validator for WebM/Opus MediaRecorder output, not a general Matroska decoder.
// Duration comes from packet framing and timestamps; caller-provided duration is never trusted.
public static class VoiceMessageMedia
{
    public const int MaxBytes = 2 * 1024 * 1024;
    public const int MaxDurationMs = 60_000;
    public sealed record Validated(byte[] Bytes, int DurationMs);
    private sealed class InvalidMedia : Exception;
    private sealed record Element(uint Id, int Start, int Body, int End, bool Unknown);

    public static Validated Validate(byte[] bytes)
    {
        if (bytes.Length is < 32 or > MaxBytes) throw new CommunityFailure(413, "Choose a voice recording up to 2 MiB.");
        try { return Parse(bytes); }
        catch (InvalidMedia) { throw new CommunityFailure(422, "Use an audio-only WebM/Opus recording up to 60 seconds."); }
    }

    private static Validated Parse(byte[] bytes)
    {
        var header = Read(bytes, 0, bytes.Length);
        Require(header.Id == 0x1a45dfa3 && !header.Unknown);
        var headerFields = Children(bytes, header);
        Require(Body(bytes, One(headerFields, 0x4282)).SequenceEqual("webm"u8));
        var segment = Read(bytes, header.End, bytes.Length); Require(segment.Id == 0x18538067 && segment.End == bytes.Length);
        Element? info = null; var hasTrack = false; ulong number = 0;
        double sum = 0, lastEnd = 0, lastTimestamp = -1; var blocks = 0; var count = 0;
        for (var offset = segment.Body; offset < segment.End;)
        {
            Require(++count <= 32768);
            var element = Read(bytes, offset, segment.End);
            if (element.Id == 0x1549a966)
            {
                Require(info is null && !element.Unknown && blocks == 0); info = element;
                var fields = Children(bytes, element);
                Require(fields.All(field => field.Id is 0x2ad7b1 or 0x4d80 or 0x5741 or 0x4489 or 0xec));
                var scales = fields.Where(field => field.Id == 0x2ad7b1).ToArray();
                Require(scales.Length <= 1 && (scales.Length == 0 || UInt(bytes, scales[0]) == 1_000_000));
            }
            else if (element.Id == 0x1654ae6b)
            {
                Require(!hasTrack && !element.Unknown && blocks == 0);
                var tracks = Children(bytes, element); Require(tracks.Count == 1 && tracks[0].Id == 0xae);
                var fields = Children(bytes, tracks[0]);
                Require(fields.All(field => field.Id is 0xd7 or 0x73c5 or 0x83 or 0x86 or 0x63a2 or 0xe1 or 0xb9 or 0x88 or 0x55aa or 0x56aa or 0x56bb or 0x23e383 or 0xec));
                number = UInt(bytes, One(fields, 0xd7)); Require(number is > 0 and <= 127);
                Require(UInt(bytes, One(fields, 0x83)) == 2 && Body(bytes, One(fields, 0x86)).SequenceEqual("A_OPUS"u8));
                var opus = Body(bytes, One(fields, 0x63a2));
                Require(opus.Length == 19 && opus[..8].SequenceEqual("OpusHead"u8) && opus[8] == 1 && opus[9] is 1 or 2 && opus[18] == 0);
                Require(BinaryPrimitives.ReadUInt16LittleEndian(opus[10..]) <= 3840);
                var audio = Children(bytes, One(fields, 0xe1));
                Require(audio.All(field => field.Id is 0xb5 or 0x9f or 0x6264 or 0xec));
                Require(UInt(bytes, One(audio, 0x9f)) == opus[9]);
                var frequency = Body(bytes, One(audio, 0xb5));
                Require(frequency.Length is 4 or 8);
                var hz = frequency.Length == 4 ? BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32BigEndian(frequency)) : BitConverter.Int64BitsToDouble(BinaryPrimitives.ReadInt64BigEndian(frequency));
                Require(hz == 48000);
                hasTrack = true;
            }
            else if (element.Id == 0x1f43b675)
            {
                Require(info is not null && hasTrack);
                var position = element.Body; ulong? timestamp = null;
                while (position < element.End)
                {
                    Require(++count <= 32768);
                    var child = Read(bytes, position, element.End);
                    // Unknown-sized clusters terminate at the next level-one cluster, never recurse.
                    if (child.Id == 0x1f43b675) { Require(element.Unknown); break; }
                    Require(!child.Unknown);
                    if (child.Id == 0xe7) { Require(timestamp is null); timestamp = UInt(bytes, child); Require(timestamp <= MaxDurationMs); }
                    else if (child.Id == 0xa3)
                    {
                        Require(timestamp.HasValue);
                        var block = Body(bytes, child); Require(block.Length >= 5);
                        var track = Vint(block, 0, false, out var width, out var unknown); Require(!unknown && track == number);
                        Require(width + 3 < block.Length && (block[width + 2] & 0x06) == 0); // No lacing.
                        var start = (double)timestamp!.Value + BinaryPrimitives.ReadInt16BigEndian(block[width..]);
                        Require(start >= 0 && start >= lastTimestamp); lastTimestamp = start;
                        var duration = PacketDuration(block[(width + 3)..]); sum += duration; lastEnd = start + duration;
                        Require(sum <= MaxDurationMs && lastEnd <= MaxDurationMs && ++blocks <= 24000);
                    }
                    else Require(child.Id == 0xec);
                    position = child.End;
                }
                Require(timestamp.HasValue); offset = position; continue;
            }
            else Require(element.Id == 0xec && !element.Unknown);
            offset = element.End;
        }
        Require(info is not null && hasTrack && blocks > 0 && sum > 0);
        var durationMs = (int)Math.Ceiling(Math.Max(sum, lastEnd));
        // Finalize Duration and the segment size deterministically, without transcoding.
        // SeekHead/Cues and CRCs are deliberately unsupported so inserting bytes cannot invalidate offsets/checksums.
        using var infoData = new MemoryStream();
        foreach (var field in Children(bytes, info!)) if (field.Id != 0x4489) infoData.Write(bytes.AsSpan(field.Start, field.End - field.Start));
        infoData.Write(new byte[] { 0x44, 0x89, 0x88 });
        var encodedDuration = new byte[8]; BinaryPrimitives.WriteInt64BigEndian(encodedDuration, BitConverter.DoubleToInt64Bits(durationMs)); infoData.Write(encodedDuration);
        using var output = new MemoryStream(); output.Write(bytes.AsSpan(0, header.End)); output.Write(new byte[] { 0x18, 0x53, 0x80, 0x67 });
        var infoSize = infoData.Length; var infoHeader = new byte[12]; BinaryPrimitives.WriteUInt32BigEndian(infoHeader, 0x1549a966); Size(infoHeader.AsSpan(4), (ulong)infoSize);
        var segmentLength = bytes.Length - segment.Body - (info!.End - info.Start) + infoHeader.Length + infoSize;
        var segmentSize = new byte[8]; Size(segmentSize, (ulong)segmentLength); output.Write(segmentSize);
        output.Write(bytes.AsSpan(segment.Body, info.Start - segment.Body)); output.Write(infoHeader); infoData.Position = 0; infoData.CopyTo(output);
        output.Write(bytes.AsSpan(info.End)); Require(output.Length <= MaxBytes);
        return new(output.ToArray(), durationMs);
    }

    private static double PacketDuration(ReadOnlySpan<byte> packet)
    {
        Require(packet.Length is > 0 and <= 65536); var config = packet[0] >> 3;
        double frame = config >= 16 ? 2.5 * (1 << (config & 3)) : config >= 12 ? 10 * (1 << (config & 1)) : (config & 3) == 3 ? 60 : 10 * (1 << (config & 3));
        var code = packet[0] & 3; var cursor = 1; var end = packet.Length; var frames = code == 0 ? 1 : 2; var vbr = code == 2;
        if (code == 3)
        {
            Require(cursor < end); var flags = packet[cursor++]; frames = flags & 63; vbr = (flags & 128) != 0;
            Require(frames > 0 && frames * frame <= 120);
            if ((flags & 64) != 0)
            {
                int padding = 0, value;
                do { Require(cursor < end); value = packet[cursor++]; padding += value == 255 ? 254 : value; Require(padding <= packet.Length); } while (value == 255);
                end -= padding; Require(cursor <= end);
            }
        }
        var lengths = 0;
        if (vbr)
        {
            for (var i = 0; i < frames - 1; i++)
            {
                Require(cursor < end); var first = packet[cursor++]; var length = (int)first;
                if (first >= 252) { Require(cursor < end); length += 4 * packet[cursor++]; }
                Require(length <= 1275); lengths += length;
            }
            Require(end - cursor - lengths is >= 0 and <= 1275);
        }
        else Require(end >= cursor && (end - cursor) % frames == 0 && (end - cursor) / frames <= 1275);
        Require(frames * frame <= 120); return frames * frame;
    }

    private static Element One(List<Element> fields, uint id) { var matches = fields.Where(item => item.Id == id).ToArray(); Require(matches.Length == 1); return matches[0]; }
    private static ReadOnlySpan<byte> Body(byte[] bytes, Element element) => bytes.AsSpan(element.Body, element.End - element.Body);
    private static ulong UInt(byte[] bytes, Element element) { var span = Body(bytes, element); Require(span.Length is > 0 and <= 8); ulong value = 0; foreach (var item in span) value = (value << 8) | item; return value; }
    private static List<Element> Children(byte[] bytes, Element parent)
    {
        var children = new List<Element>(); for (var offset = parent.Body; offset < parent.End;) { Require(children.Count < 128); var child = Read(bytes, offset, parent.End); Require(!child.Unknown); children.Add(child); offset = child.End; } return children;
    }
    private static Element Read(byte[] bytes, int offset, int end)
    {
        Require(offset >= 0 && offset < end && end <= bytes.Length);
        var id = Vint(bytes.AsSpan(0, end), offset, true, out var idWidth, out _); Require(idWidth <= 4);
        var length = Vint(bytes.AsSpan(0, end), offset + idWidth, false, out var width, out var unknown);
        var body = offset + idWidth + width; Require(unknown || length <= (ulong)(end - body));
        return new((uint)id, offset, body, unknown ? end : body + (int)length, unknown);
    }
    private static ulong Vint(ReadOnlySpan<byte> bytes, int offset, bool identifier, out int width, out bool unknown)
    {
        Require(offset >= 0 && offset < bytes.Length && bytes[offset] != 0); width = 1; var mask = 128;
        while ((bytes[offset] & mask) == 0) { width++; mask >>= 1; }
        Require(width <= 8 && offset + width <= bytes.Length); ulong value = identifier ? bytes[offset] : (uint)(bytes[offset] & (mask - 1));
        for (var i = 1; i < width; i++) value = (value << 8) | bytes[offset + i];
        unknown = !identifier && value == ((1UL << (7 * width)) - 1); return value;
    }
    private static void Size(Span<byte> target, ulong size) => BinaryPrimitives.WriteUInt64BigEndian(target, size | (1UL << 56));
    private static void Require(bool condition) { if (!condition) throw new InvalidMedia(); }
}
