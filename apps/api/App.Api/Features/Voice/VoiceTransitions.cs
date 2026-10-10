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

    public static async Task RevokeMemberAsync(AppDbContext database, Guid community, Guid user, CancellationToken ct)
    {
        var leases = await database.VoiceLeases.Where(item => item.CommunityId == community && item.UserId == user && item.Active).ToArrayAsync(ct);
        if (leases.Length == 0) return;
        foreach (var lease in leases) lease.Active = false;
        var room = await database.VoiceRooms.SingleAsync(item => item.CommunityId == community, ct);
        Request(room);
    }
}
