using System.Net;
using System.Net.Http.Json;
using App.Api.Features.Voice;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace App.IntegrationTests;

public sealed partial class VoiceTests
{
    private static async Task<TimeSpan> NextCheckIn(FoundationFactory host, string community)
    {
        using var scope = host.Services.CreateScope();
        var room = await scope.ServiceProvider.GetRequiredService<AppDbContext>().VoiceRooms.AsNoTracking().SingleAsync(item => item.ChannelId == Guid.Parse(community));
        return room.NextCheckAt - DateTimeOffset.UtcNow;
    }

    private static async Task ExpireGrants(FoundationFactory host, string community)
    {
        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.VoiceGrantRequests.Where(item => item.Lease.ChannelId == Guid.Parse(community))
            .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-2)));
    }

    private static async Task<int> RetiredCount(FoundationFactory host, string community)
    {
        using var scope = host.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().RetiredVoiceRooms.CountAsync(item => item.CommunityId == Guid.Parse(community));
    }

    private static readonly TimeSpan Short = TimeSpan.FromSeconds(4);
    private static readonly TimeSpan Long = TimeSpan.FromMinutes(1);

    [Fact]
    public async Task EmptyRoomBacksOffOnlyWhenNobodyCanEnterAndJoinWakesIt()
    {
        var voice = new FakeVoice(); await using var host = Factory(voice);
        using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); await Register(member);
        var community = await Create(owner); await AddMember(owner, member, community);

        // Never used: no lease, no grant, empty SFU.
        await Reconcile(host, community);
        Assert.True(await NextCheckIn(host, community) > Long);

        // A new grant wakes the room immediately, and an active lease keeps it live.
        var grant = await Grant(member, community);
        Assert.True(await NextCheckIn(host, community) <= TimeSpan.Zero);
        await Reconcile(host, community);
        Assert.True(await NextCheckIn(host, community) < Short);

        // After leave the token is still valid, so a replay must still be caught.
        var leave = new VoiceLeaseRequest(Guid.Parse(grant.LeaseId));
        Assert.Equal(HttpStatusCode.OK, (await Send(member, Path(community, "/leave"), leave)).StatusCode);
        await Reconcile(host, community);
        Assert.True(await NextCheckIn(host, community) < Short);

        // Grant expired, but the SFU still reports the departed identity.
        await ExpireGrants(host, community);
        voice.Actual.Add(new(grant.Identity, true, 1));
        await Reconcile(host, community);
        Assert.Contains(Guid.Parse(grant.LeaseId), voice.Removed);
        Assert.True(await NextCheckIn(host, community) < Short);

        // Control failure is retried on the failure cadence, never the idle one.
        voice.Fail = true; await Reconcile(host, community);
        var failing = await NextCheckIn(host, community);
        Assert.True(failing > TimeSpan.FromSeconds(1) && failing < Short);

        voice.Fail = false; await Reconcile(host, community);
        Assert.True(await NextCheckIn(host, community) > Long);
        Assert.Empty(voice.Deleted);
        Assert.Equal("1", (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!.Generation);
    }

    [Fact]
    public async Task RevocationStillWakesQuiescentRoom()
    {
        var voice = new FakeVoice(); await using var host = Factory(voice);
        using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); var profile = await Register(member);
        var community = await Create(owner); await AddMember(owner, member, community);
        await Grant(member, community);
        await Reconcile(host, community);
        // Simulate a room that went quiet while a lease is still recorded active.
        using (var scope = host.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().VoiceRooms.Where(item => item.ChannelId == Guid.Parse(community))
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.NextCheckAt, DateTimeOffset.UtcNow.AddMinutes(5)));
        Assert.True((await Send(owner, $"/api/v1/communities/{community}/members/{profile.Id}/ban", new { Banned = true }, "PUT")).IsSuccessStatusCode);
        Assert.True(await NextCheckIn(host, community) <= TimeSpan.Zero);
        Assert.Equal("Pending", (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!.Status);
    }

    [Fact]
    public async Task RetiredRoomRecordIsDroppedOnlyAfterItsGrantsExpire()
    {
        var voice = new FakeVoice(); await using var host = Factory(voice);
        using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); var profile = await Register(member);
        var community = await Create(owner); await AddMember(owner, member, community);
        await Grant(member, community);
        Assert.True((await Send(owner, $"/api/v1/communities/{community}/members/{profile.Id}/ban", new { Banned = true }, "PUT")).IsSuccessStatusCode);
        await Reconcile(host, community);
        Assert.Equal("2", (await owner.GetFromJsonAsync<VoiceStateDto>(Path(community)))!.Generation);
        Assert.Equal(1, await RetiredCount(host, community));

        // The old grant could still recreate generation 1: keep deleting it.
        await Reconcile(host, community);
        Assert.Equal(1, await RetiredCount(host, community));
        Assert.True(await NextCheckIn(host, community) < Short);
        var deletes = voice.Deleted.Count;
        Assert.True(deletes >= 2);

        // Once that grant expired, one more confirmed delete is final.
        await ExpireGrants(host, community);
        voice.Fail = true; await Reconcile(host, community);
        Assert.Equal(1, await RetiredCount(host, community));
        voice.Fail = false; await Reconcile(host, community);
        Assert.Equal(0, await RetiredCount(host, community));
        Assert.Equal(deletes + 1, voice.Deleted.Count);
        Assert.True(await NextCheckIn(host, community) > Long);

        await Reconcile(host, community);
        Assert.Equal(deletes + 1, voice.Deleted.Count);
    }
}
