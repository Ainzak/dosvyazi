using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Voice;

public static class VoiceTransitions
{
    // Caller owns the community writer lock and its transaction.
    public static void Request(VoiceRoomBinding room)
    {
        if (room.Status != "Pending") room.OperationId = Guid.NewGuid();
        room.Status = "Pending";
        room.CompletedAt = null;
        room.NextCheckAt = DateTimeOffset.UtcNow;
    }

    // Ready still permits other authorized admissions. The existing durable
    // operation receipt distinguishes pending removal from an ordinary health read.
    public static bool RemovalPending(VoiceRoomBinding room) => room.Status == "Ready" && room.OperationId is not null && room.CompletedAt is null;
    public static void ScheduleRemoval(VoiceRoomBinding room)
    {
        if (room.Status == "Ready")
        {
            if (!RemovalPending(room)) room.OperationId = Guid.NewGuid();
            room.CompletedAt = null;
        }
        room.NextCheckAt = DateTimeOffset.UtcNow;
    }

    public static async Task RevokeMemberAsync(AppDbContext database, Guid community, Guid user, CancellationToken ct, bool targeted = false)
    {
        var leases = await database.VoiceLeases.Where(item => item.CommunityId == community && item.UserId == user && item.Active).ToArrayAsync(ct);
        if (leases.Length == 0) return;
        foreach (var lease in leases) lease.Active = false;
        var channels = leases.Select(item => item.ChannelId).Distinct().ToArray();
        foreach (var room in await database.VoiceRooms.Where(item => item.CommunityId == community && channels.Contains(item.ChannelId)).ToArrayAsync(ct))
        {
            if (targeted && room.AdmissionProtected && room.AdmissionAttempt is null) ScheduleRemoval(room);
            else Request(room);
        }
    }
}
