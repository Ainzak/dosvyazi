using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using App.Api.Features.Communities;
using App.Api.Features.Messages;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace App.IntegrationTests;

public sealed partial class AccessTests
{
    [Fact]
    public async Task RightsExplainActualDenyAndPrerequisitesWithoutLeakingHiddenResources()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory); using var outsider = await User(factory);
        var c = await Create(owner); await Join(owner, member, c); var id = Guid.Parse(c.Id); var channel = Guid.Parse(c.Channels[0].Id);
        var p = await Policy(owner, c); var category = Guid.NewGuid(); var role = Guid.NewGuid(); var secret = Guid.NewGuid();
        p = p with { Roles = [p.Roles[0] with { Grants = 0 }, new(role, "speaker", 96 | 2048 | 4096, 1)], Categories = [new(category, "public category")],
            Channels = [p.Channels[0] with { CategoryId = category }, new(secret, "hidden-room", null)],
            Members = [new(Guid.Parse(member.Profile.Id), [role])], CategoryRules = [new(category, id, 0, 2)], ChannelRules = [new(channel, role, 3, 0)],
            VoiceRules = [new(id, role, 1 | 4096, 2048)] };
        Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, p)).StatusCode);
        var root = Root(c);
        var text = await member.Client.GetFromJsonAsync<RightsExplanation>(root + $"/rights?kind=text&channelId={channel}");
        Assert.False(text!.OwnerOverride); Assert.True(text.Decisions.Single(d => d.Permission == "ViewChannel").Allowed);
        Assert.False(text.Decisions.Single(d => d.Permission == "SendMessage").Allowed);
        Assert.Contains(text.Sources, s => s.Scope == "category" && s.Deny == 2);
        Assert.False((await member.Client.GetFromJsonAsync<ChannelSummary>(root + $"/channels/{channel}"))!.CanSend);
        var voice = await member.Client.GetFromJsonAsync<RightsExplanation>(root + "/rights?kind=voice");
        Assert.False(voice!.Decisions.Single(d => d.Permission == "SpeakVoice").Allowed);
        Assert.False(voice.Decisions.Single(d => d.Permission == "ConnectVoice").Allowed);
        var owned = await owner.Client.GetFromJsonAsync<RightsExplanation>(root + $"/rights?kind=text&channelId={secret}");
        Assert.True(owned!.OwnerOverride); Assert.All(owned.Decisions, d => Assert.True(d.Allowed));
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(root + $"/rights?kind=text&channelId={secret}&userId={owner.Profile.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync(root + "/rights?kind=voice")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync(root + "/configuration")).StatusCode);
        // Losing management privileges cannot leave cross-member explanation accessible on retry.
        var current = await Policy(owner, c);
        Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, current with { Roles = current.Roles.Select(r => r.Id == role ? r with { Grants = 2048 | 4096 } : r).ToArray() })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync(root + $"/rights?kind=text&channelId={channel}&userId={owner.Profile.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(root + $"/rights?kind=text&channelId={channel}&userId={outsider.Profile.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Command(owner.Client, root + $"/members/{member.Profile.Id}/kick")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(root + $"/rights?kind=text&channelId={channel}")).StatusCode);
    }

    [Fact]
    public async Task ConfigurationRestoreIsIsolatedConcurrentIdempotentAndPayloadBound()
    {
        await using var factory = Factory(); using var owner = await User(factory); using var member = await User(factory);
        var c = await Create(owner); await Join(owner, member, c); var id = Guid.Parse(c.Id); var channel = Guid.Parse(c.Channels[0].Id);
        Assert.Equal(HttpStatusCode.Created, (await Command(owner.Client, Channel(c) + "/messages", new SendMessageRequest(Guid.NewGuid(), "Must never be exported"))).StatusCode);
        var p = await Policy(owner, c); var category = Guid.NewGuid(); var role = Guid.NewGuid();
        p = p with { Roles = [p.Roles[0] with { Grants = 0 }, new(role, "trusted", 3 | 2048 | 4096, 5)], Categories = [new(category, "private category")],
            Channels = [p.Channels[0] with { CategoryId = category }], Members = [new(Guid.Parse(member.Profile.Id), [role])],
            ChannelRules = [new(channel, role, 3, 0)], CategoryRules = [new(category, id, 0, 2)], VoiceCategoryId = category, VoiceRules = [new(id, role, 2048, 4096)] };
        Assert.Equal(HttpStatusCode.OK, (await Save(owner, c, p)).StatusCode);
        using var export = await owner.Client.GetAsync(Root(c) + "/configuration"); Assert.Equal(HttpStatusCode.OK, export.StatusCode); Assert.True(export.Headers.CacheControl!.NoStore);
        var body = await export.Content.ReadAsStringAsync();
        Assert.DoesNotContain(member.Profile.Id, body); Assert.DoesNotContain(owner.Profile.Id, body); Assert.DoesNotContain("Must never", body); Assert.DoesNotContain("members", body); Assert.DoesNotContain("clientRequestId", body);
        var doc = JsonSerializer.Deserialize<CommunityConfiguration>(body, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        var requestId = Guid.NewGuid(); var request = new { clientRequestId = requestId, name = "Isolated clone", configuration = doc };
        var responses = await Task.WhenAll(Command(owner.Client, "/api/v1/communities/configuration/restore", request), Command(owner.Client, "/api/v1/communities/configuration/restore", request));
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));
        var restored = (await responses[0].Content.ReadFromJsonAsync<ConfigurationRestored>())!;
        Assert.Equal(restored, await responses[1].Content.ReadFromJsonAsync<ConfigurationRestored>());
        Assert.NotEqual(c.Id, restored.CommunityId);
        var root = $"/api/v1/communities/{restored.CommunityId}";
        var copy = (await owner.Client.GetFromJsonAsync<CommunityDetails>(root))!; Assert.Equal(1, copy.MemberCount); Assert.Equal("Isolated clone", copy.Name); Assert.NotEqual(c.Channels[0].Id, copy.Channels[0].Id);
        var copyPolicy = (await owner.Client.GetFromJsonAsync<AccessPolicy>(root + "/access"))!;
        Assert.Empty(copyPolicy.Members); Assert.Equal("private category", Assert.Single(copyPolicy.Categories).Name); Assert.Equal(5, copyPolicy.Roles.Single(r => r.Name == "trusted").Rank);
        var copyRole = copyPolicy.Roles.Single(r => r.Name == "trusted").Id;
        Assert.NotEqual(role, copyRole); Assert.Equal(copyRole, Assert.Single(copyPolicy.ChannelRules).RoleId);
        Assert.Equal(Guid.Parse(copy.Channels[0].Id), Assert.Single(copyPolicy.ChannelRules).ResourceId);
        Assert.Equal(4096, Assert.Single(copyPolicy.VoiceRules!).Deny); Assert.Equal(copyPolicy.Categories[0].Id, copyPolicy.VoiceCategoryId);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var newId = Guid.Parse(restored.CommunityId);
        Assert.False(await db.Messages.AnyAsync(m => db.TextChannels.Any(ch => ch.CommunityId == newId && ch.Id == m.ChannelId))); Assert.False(await db.CommunityInvites.AnyAsync(i => i.CommunityId == newId)); Assert.False(await db.MemberRoles.AnyAsync(m => m.CommunityId == newId));
        Assert.Equal(2, (await owner.Client.GetFromJsonAsync<CommunityDetails>(Root(c)))!.MemberCount);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(root)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner.Client, "/api/v1/communities/configuration/restore", new { clientRequestId = requestId, name = "Different", configuration = doc })).StatusCode);
        var changed = doc with { Roles = doc.Roles.Select(r => r with { Grants = 0 }).ToArray() };
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner.Client, "/api/v1/communities/configuration/restore", new { clientRequestId = requestId, name = "Isolated clone", configuration = changed })).StatusCode);
        foreach (var response in responses) response.Dispose();
        // Possession of a template permits creation, never membership/access to its source.
        using var stranger = await User(factory);
        Assert.Equal(HttpStatusCode.Created, (await Command(stranger.Client, "/api/v1/communities/configuration/restore", new { clientRequestId = Guid.NewGuid(), name = "Independent", configuration = doc })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.Client.GetAsync(Root(c))).StatusCode);
    }

    [Fact]
    public async Task ConfigurationRejectsUnknownFieldsVersionsUnboundedAndCrossReferencesBeforeWriting()
    {
        await using var factory = Factory(); using var owner = await User(factory); var c = await Create(owner);
        var doc = (await owner.Client.GetFromJsonAsync<CommunityConfiguration>(Root(c) + "/configuration"))!;
        var valid = JsonSerializer.SerializeToNode(doc, new JsonSerializerOptions(JsonSerializerDefaults.Web))!.AsObject();
        var unknown = valid.DeepClone().AsObject(); unknown["members"] = new System.Text.Json.Nodes.JsonArray();
        var nested = valid.DeepClone().AsObject(); nested["roles"]![0]!["userId"] = Guid.NewGuid().ToString();
        object[] bad = [unknown, nested, doc with { Version = 99 }, doc with { Roles = null! }, doc with { Channels = [] }, doc with { Roles = [doc.Roles[0] with { Grants = 8 }] },
            doc with { Channels = [doc.Channels[0] with { CategoryId = Guid.NewGuid() }] }, doc with { ChannelRules = [new(Guid.NewGuid(), doc.EveryoneRoleId, 1, 0)] },
            doc with { VoiceRules = [new(Guid.NewGuid(), doc.EveryoneRoleId, 2048, 0)] }, doc with { Roles = Enumerable.Repeat(doc.Roles[0], 21).ToArray() }];
        foreach (var document in bad)
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await Command(owner.Client, "/api/v1/communities/configuration/preview", new { configuration = document })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await Command(owner.Client, "/api/v1/communities/configuration/restore", new { clientRequestId = Guid.NewGuid(), name = "Invalid", configuration = document })).StatusCode);
        }
        Assert.Single((await owner.Client.GetFromJsonAsync<CommunitySummary[]>("/api/v1/communities"))!);
        Assert.Equal(HttpStatusCode.OK, (await Command(owner.Client, "/api/v1/communities/configuration/preview", new { configuration = doc })).StatusCode);
        var duplicate = await Command(owner.Client, "/api/v1/communities/configuration/restore", new { clientRequestId = Guid.NewGuid(), name = "No csrf", configuration = doc });
        Assert.Equal(HttpStatusCode.Created, duplicate.StatusCode);
        using var missingCsrf = await owner.Client.PostAsJsonAsync("/api/v1/communities/configuration/restore", new { clientRequestId = Guid.NewGuid(), name = "No csrf", configuration = doc }); Assert.Equal(HttpStatusCode.BadRequest, missingCsrf.StatusCode);
        using var anon = factory.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync(Root(c) + "/configuration")).StatusCode);
    }
}
