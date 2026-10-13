using System.Buffers.Binary;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Gatherings;
public sealed partial class GatheringService
{
    private static string CoverType(PreparedAttachment file)
    {
        var b = file.Bytes;
        if (b.Length > 2 * 1024 * 1024) throw new CommunityFailure(422, "Choose a PNG or JPEG cover up to 2 MiB and 2048 by 2048 pixels.");
        if (b.Length >= 33 && b.AsSpan().StartsWith(new byte[] {137,80,78,71,13,10,26,10}) && b.AsSpan(12,4).SequenceEqual("IHDR"u8) &&
            BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(16,4)) is >= 1 and <= 2048 && BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(20,4)) is >= 1 and <= 2048) return "image/png";
        if (b.Length >= 4 && b[0] == 255 && b[1] == 216)
        {
            var p = 2;
            while (p + 4 < b.Length)
            {
                if (b[p++] != 255) break;
                while (p < b.Length && b[p] == 255) p++;
                if (p >= b.Length) break; var marker = b[p++];
                if (marker is 217 or 218) break;
                if (marker is 1 or >= 208 and <= 215) continue;
                if (p + 2 > b.Length) break;
                var length = BinaryPrimitives.ReadUInt16BigEndian(b.AsSpan(p,2)); if (length < 2 || p + length > b.Length) break;
                if (marker is 192 or 193 or 194 && length >= 8 && BinaryPrimitives.ReadUInt16BigEndian(b.AsSpan(p+3,2)) is >= 1 and <= 2048 && BinaryPrimitives.ReadUInt16BigEndian(b.AsSpan(p+5,2)) is >= 1 and <= 2048) return "image/jpeg";
                p += length;
            }
        }
        throw new CommunityFailure(422, "Choose a PNG or JPEG cover up to 2 MiB and 2048 by 2048 pixels.");
    }
    public async Task<GatheringDto> Cover(Guid community, Guid id, Guid user, GatheringCoverRequest r, PreparedAttachment? file, AttachmentStore store, CancellationToken ct)
    {
        var type = file is null ? "" : CoverType(file);
        await using var tx = await db.Database.BeginTransactionAsync(ct); var g = await Authorized(community, id, user, ct, true);
        var hash = Hash(new { cover = id, r, fileHash = file?.Hash });
        if (await Prior(community, user, r.ClientRequestId, hash, ct) is null)
        {
            Version(g, r.ExpectedVersion); Scheduled(g);
            if (g.CoverId is not null) (await db.GatheringCovers.SingleAsync(c => c.Id == g.CoverId && c.GatheringId == id, ct)).Retired = true;
            g.CoverId = null;
            if (file is not null)
            {
                await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(73421891)", ct);
                if (store.UsedBytes() + file.Bytes.Length > store.QuotaBytes) throw new CommunityFailure(409, "Attachment storage is full. Ask the operator to free space.");
                var cover = new GatheringCover { Id = Guid.NewGuid(), GatheringId = id, ContentType = type };
                await store.WriteAsync(cover.Id, file.Bytes, ct); db.GatheringCovers.Add(cover); g.CoverId = cover.Id;
            }
            g.Version++; Command(g, user, r.ClientRequestId, hash); Changed(g, user, "cover"); await db.SaveChangesAsync(ct);
        }
        var result = await Dto(g, user, ct); await tx.CommitAsync(ct); return result;
    }
    // Called by membership writers under the same community lock/transaction.
    public async Task RevokeMember(Guid community, Guid user, CancellationToken ct)
    {
        foreach (var g in await db.Gatherings.Include(g => g.Invites).Where(g => g.CommunityId == community && g.Invites.Any(i => i.UserId == user && i.Active)).ToArrayAsync(ct))
        {
            g.Invites.Single(i => i.UserId == user).Active = false; g.Version++; Changed(g, user, "membership", [user]);
        }
    }
}
