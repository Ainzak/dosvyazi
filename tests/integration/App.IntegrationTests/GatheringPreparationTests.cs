using System.Net;
using System.Net.Http.Json;
using System.Text;
using App.Api.Features.Gatherings;
using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace App.IntegrationTests;

public sealed class GatheringCalendarTests
{
    [Fact]
    public void CalendarFoldsUtf8EscapesTextAndContainsOnlyMinimalSnapshot()
    {
        var g = new Gathering { Id = Guid.NewGuid(), Title = new string('Я', 65) + ";,\\\r\nATTENDEE:secret", StartAt = new(2027, 1, 2, 12, 0, 0, TimeSpan.FromHours(3)), Version = 42,
            Description = "Private description", Game = "Private game", Status = "Cancelled" };
        var text = GatheringCalendar.Export(g, DateTimeOffset.UtcNow);
        Assert.All(text.Split("\r\n"), line => Assert.True(Encoding.UTF8.GetByteCount(line) <= 75));
        var unfolded = text.Replace("\r\n ", "");
        Assert.Contains("DTSTART:20270102T090000Z\r\n", text);
        Assert.Contains("SEQUENCE:42", text); Assert.Contains("STATUS:CANCELLED", text);
        Assert.Contains("\\;\\,\\\\\\nATTENDEE:secret", unfolded);
        Assert.DoesNotContain("\r\nATTENDEE:", text); Assert.DoesNotContain("ORGANIZER:", text);
        Assert.DoesNotContain("Private", text); Assert.DoesNotContain("URL:", text);
        Assert.Contains($"UID:{g.Id:D}@dosvyazi", text);
        Assert.Equal(65, text.Count(c => c == 'Я'));
    }
}

public sealed partial class GatheringTests
{
    [Fact]
    public async Task ChecklistBoundsAndCrossGatheringIdsReturnControlledErrors()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var member = host.CreateClient();
        await Register(owner); var pm = await Register(member); var c = await CreateCommunity(owner); await Join(owner, member, c);
        var g = await Result(await Command(owner, Root(c), Plan(pm))); var path = Root(c) + "/" + g.Id; var id = Guid.NewGuid();
        var p = await Prepared(await Command(owner, path + "/checklist/" + id, new ChecklistRequest(Guid.NewGuid(), g.Version, "save", new string('X', 160)), "PUT"));
        foreach (var invalid in new[] { "", " \t", "Bad\0text" }) Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(owner, path + "/checklist/" + Guid.NewGuid(), new ChecklistRequest(Guid.NewGuid(), p.Version, "save", invalid), "PUT")).StatusCode);
        for (var n = 1; n < 30; n++) p = await Prepared(await Command(owner, path + "/checklist/" + Guid.NewGuid(), new ChecklistRequest(Guid.NewGuid(), p.Version, "save", "Task " + n), "PUT"));
        Assert.Equal(30, p.Items.Length);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner, path + "/checklist/" + Guid.NewGuid(), new ChecklistRequest(Guid.NewGuid(), p.Version, "save", "Too many"), "PUT")).StatusCode);
        var another = await Result(await Command(owner, Root(c), Plan(pm)));
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner, Root(c) + "/" + another.Id + "/checklist/" + id, new ChecklistRequest(Guid.NewGuid(), another.Version, "save", "Cross-scope"), "PUT")).StatusCode);
        var otherCommunity = await CreateCommunity(owner); await Join(owner, member, otherCommunity);
        var otherGathering = await Result(await Command(owner, Root(otherCommunity), Plan(pm))); var raceId = Guid.NewGuid();
        var race = await Task.WhenAll(Command(owner, Root(c) + "/" + another.Id + "/checklist/" + raceId, new ChecklistRequest(Guid.NewGuid(), another.Version, "save", "Race one"), "PUT"),
            Command(owner, Root(otherCommunity) + "/" + otherGathering.Id + "/checklist/" + raceId, new ChecklistRequest(Guid.NewGuid(), otherGathering.Version, "save", "Race two"), "PUT"));
        Assert.Single(race, r => r.IsSuccessStatusCode); Assert.Single(race, r => r.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(member, path + "/reminder", new ReminderRequest(Guid.NewGuid(), 1, "0", 7), "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync("/health/ready")).StatusCode);
    }
    private static async Task<GatheringPreparationDto> Prepared(HttpResponseMessage response)
    {
        using (response) { Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync()); return (await response.Content.ReadFromJsonAsync<GatheringPreparationDto>())!; }
    }
    [Fact]
    public async Task ChecklistRightsVersionsRetriesAndRetirementAreEnforced()
    {
        await using var host = Factory(); using var owner = host.CreateClient(); using var a = host.CreateClient(); using var b = host.CreateClient(); using var other = host.CreateClient();
        await Register(owner); var pa = await Register(a); var pb = await Register(b); var po = await Register(other);
        var c = await CreateCommunity(owner); foreach (var member in new[] { a, b, other }) await Join(owner, member, c);
        var plan = Plan(pa, pb); var g = await Result(await Command(owner, Root(c), plan)); var path = Root(c) + "/" + g.Id;
        var id = Guid.NewGuid(); var request = new ChecklistRequest(Guid.NewGuid(), g.Version, "save", "Install game", Guid.Parse(pa.Id));
        var p = await Prepared(await Command(owner, path + "/checklist/" + id, request, "PUT"));
        Assert.Single(p.Items); Assert.Equal(p.Version, (await Prepared(await Command(owner, path + "/checklist/" + id, request, "PUT"))).Version);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner, path + "/checklist/" + id, request with { Text = "Different" }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(a, path + "/checklist/" + id, request with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = p.Version }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Command(b, path + "/checklist/" + id, new ChecklistRequest(Guid.NewGuid(), p.Version, "complete", Done: true), "PUT")).StatusCode);
        foreach (var suffix in new[] { "/preparation", "/calendar" }) Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(path + suffix)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Command(owner, path + "/checklist/" + id, request with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = p.Version, AssigneeId = Guid.Parse(po.Id) }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(a, path + "/checklist/" + id, new ChecklistRequest(Guid.NewGuid(), g.Version, "complete", Done: true), "PUT")).StatusCode);
        var complete = new ChecklistRequest(Guid.NewGuid(), p.Version, "complete", Done: true);
        p = await Prepared(await Command(a, path + "/checklist/" + id, complete, "PUT")); Assert.True(p.Items.Single().Done);
        p = await Prepared(await Command(owner, path + "/checklist/" + id, new ChecklistRequest(Guid.NewGuid(), p.Version, "save", "Install changed game", Guid.Parse(pa.Id)), "PUT")); Assert.False(p.Items.Single().Done);
        var attempts = await Task.WhenAll(Command(owner, path + "/checklist/" + Guid.NewGuid(), new ChecklistRequest(Guid.NewGuid(), p.Version, "save", "First concurrent"), "PUT"), Command(owner, path + "/checklist/" + Guid.NewGuid(), new ChecklistRequest(Guid.NewGuid(), p.Version, "save", "Second concurrent"), "PUT"));
        Assert.Single(attempts, r => r.IsSuccessStatusCode); Assert.Single(attempts, r => r.StatusCode == HttpStatusCode.Conflict);
        p = (await owner.GetFromJsonAsync<GatheringPreparationDto>(path + "/preparation"))!;
        p = await Prepared(await Command(owner, path + "/checklist/" + id, new ChecklistRequest(Guid.NewGuid(), p.Version, "remove"), "PUT"));
        p = await Prepared(await Command(owner, path + "/checklist/" + id, request, "PUT")); Assert.DoesNotContain(p.Items, i => i.Id == id.ToString());
        g = (await owner.GetFromJsonAsync<GatheringDto>(path))!;
        g = await Result(await Command(owner, path + "/status", new GatheringStatusRequest(Guid.NewGuid(), g.Version, "Cancelled"), "PUT"));
        Assert.Equal(HttpStatusCode.Conflict, (await Command(owner, path + "/checklist/" + Guid.NewGuid(), new ChecklistRequest(Guid.NewGuid(), g.Version, "save", "Too late"), "PUT")).StatusCode);
        using var calendar = await a.GetAsync(path + "/calendar"); Assert.Equal(HttpStatusCode.OK, calendar.StatusCode); Assert.True(calendar.Headers.CacheControl!.NoStore);
        Assert.Contains("STATUS:CANCELLED", await calendar.Content.ReadAsStringAsync());
    }
    [Fact]
    public async Task PersonalRemindersArePrivateDurableDeduplicatedAndCatchUpOnlyBeforeStart()
    {
        var clock = new Clock(); await using var baseHost = Factory(); await using var host = baseHost.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<TimeProvider>(clock)));
        using var owner = host.CreateClient(); using var member = host.CreateClient(); await Register(owner); var pm = await Register(member); var c = await CreateCommunity(owner); await Join(owner, member, c);
        var g = await Result(await Command(owner, Root(c), Plan(pm) with { LocalStart = clock.Now.AddHours(2).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm") })); var path = Root(c) + "/" + g.Id;
        var request = new ReminderRequest(Guid.NewGuid(), 1, "0", 15);
        var p = await Prepared(await Command(member, path + "/reminder", request, "PUT")); Assert.Equal(g.StartAt.AddMinutes(-15), p.Reminder.DueAt);
        Assert.Null((await owner.GetFromJsonAsync<GatheringPreparationDto>(path + "/preparation"))!.Reminder.Minutes);
        Assert.Equal(p.Reminder.Version, (await Prepared(await Command(member, path + "/reminder", request, "PUT"))).Reminder.Version);
        async Task Tick() { using var scope = host.Services.CreateScope(); await scope.ServiceProvider.GetRequiredService<GatheringService>().DeliverReminders(CancellationToken.None); }
        await Tick(); Assert.DoesNotContain((await member.GetFromJsonAsync<GatheringNotices>(Root(c) + "/notices"))!.Items, n => n.Kind == "reminder");
        clock.Now = g.StartAt.AddMinutes(-10); await Task.WhenAll(Tick(), Tick()); await Tick();
        var notices = (await member.GetFromJsonAsync<GatheringNotices>(Root(c) + "/notices"))!; Assert.Single(notices.Items, n => n.Kind == "reminder");
        Assert.DoesNotContain((await owner.GetFromJsonAsync<GatheringNotices>(Root(c) + "/notices"))!.Items, n => n.Kind == "reminder");
        p = (await member.GetFromJsonAsync<GatheringPreparationDto>(path + "/preparation"))!; Assert.NotNull(p.Reminder.DeliveredAt);
        p = await Prepared(await Command(member, path + "/reminder", new ReminderRequest(Guid.NewGuid(), 1, p.Reminder.Version, null), "PUT"));
        Assert.DoesNotContain((await member.GetFromJsonAsync<GatheringNotices>(Root(c) + "/notices"))!.Items, n => n.Kind == "reminder");
        p = await Prepared(await Command(member, path + "/reminder", request, "PUT")); Assert.Null(p.Reminder.Minutes); // Old uncertain retry cannot rearm.
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member, path + "/reminder", request with { ClientRequestId = Guid.NewGuid() }, "PUT")).StatusCode);
        p = await Prepared(await Command(member, path + "/reminder", new ReminderRequest(Guid.NewGuid(), 1, p.Reminder.Version, 5), "PUT"));
        clock.Now = g.StartAt.AddSeconds(1); await Tick();
        Assert.Null((await member.GetFromJsonAsync<GatheringPreparationDto>(path + "/preparation"))!.Reminder.Minutes);
        Assert.DoesNotContain((await member.GetFromJsonAsync<GatheringNotices>(Root(c) + "/notices"))!.Items, n => n.Kind == "reminder");
    }
    [Fact]
    public async Task PlanChangesCancellationAndReinvitationNeverReviveOldReadinessOrReminders()
    {
        var clock = new Clock(); await using var baseHost = Factory(); await using var host = baseHost.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<TimeProvider>(clock)));
        using var owner = host.CreateClient(); using var member = host.CreateClient(); using var second = host.CreateClient(); await Register(owner); var pm = await Register(member); var ps = await Register(second);
        var c = await CreateCommunity(owner); await Join(owner, member, c); await Join(owner, second, c);
        var plan = Plan(pm, ps) with { LocalStart = clock.Now.AddHours(2).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm") }; var g = await Result(await Command(owner, Root(c), plan)); var path = Root(c) + "/" + g.Id; var item = Guid.NewGuid();
        var p = await Prepared(await Command(owner, path + "/checklist/" + item, new ChecklistRequest(Guid.NewGuid(), g.Version, "save", "Download", Guid.Parse(pm.Id)), "PUT"));
        p = await Prepared(await Command(member, path + "/checklist/" + item, new ChecklistRequest(Guid.NewGuid(), p.Version, "complete", Done: true), "PUT"));
        p = await Prepared(await Command(member, path + "/reminder", new ReminderRequest(Guid.NewGuid(), 1, "0", 15), "PUT"));
        g = await Result(await Command(owner, path, plan with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = p.Version, Title = "New title" }, "PUT"));
        p = (await member.GetFromJsonAsync<GatheringPreparationDto>(path + "/preparation"))!; Assert.True(p.Items.Single().Done); Assert.Equal(15, p.Reminder.Minutes);
        // Same instant in another zone preserves preparation and revision.
        g = await Result(await Command(owner, path, plan with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = g.Version, TimeZoneId = "Europe/Moscow", LocalStart = g.StartAt.AddHours(3).ToString("yyyy-MM-dd'T'HH:mm") }, "PUT")); Assert.Equal(1, g.Revision);
        p = (await member.GetFromJsonAsync<GatheringPreparationDto>(path + "/preparation"))!; Assert.True(p.Items.Single().Done);
        g = await Result(await Command(owner, path, plan with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = g.Version, Game = "Changed game" }, "PUT"));
        p = (await member.GetFromJsonAsync<GatheringPreparationDto>(path + "/preparation"))!; Assert.False(p.Items.Single().Done); Assert.Null(p.Reminder.Minutes);
        Assert.Equal(HttpStatusCode.Conflict, (await Command(member, path + "/reminder", new ReminderRequest(Guid.NewGuid(), 1, p.Reminder.Version, 15), "PUT")).StatusCode);
        p = await Prepared(await Command(member, path + "/reminder", new ReminderRequest(Guid.NewGuid(), 2, p.Reminder.Version, 15), "PUT"));
        await Command(member, $"/api/v1/communities/{c.Id}/leave", new { }); await Join(owner, member, c);
        Assert.Equal(HttpStatusCode.NotFound, (await member.GetAsync(path + "/preparation")).StatusCode);
        g = (await owner.GetFromJsonAsync<GatheringDto>(path))!; g = await Result(await Command(owner, path, plan with { ClientRequestId = Guid.NewGuid(), ExpectedVersion = g.Version, Game = "Changed game" }, "PUT"));
        p = (await member.GetFromJsonAsync<GatheringPreparationDto>(path + "/preparation"))!; Assert.Null(p.Reminder.Minutes); Assert.Null(p.Items.Single().AssigneeId);
        p = await Prepared(await Command(member, path + "/reminder", new ReminderRequest(Guid.NewGuid(), g.Revision, p.Reminder.Version, 1440), "PUT"));
        g = await Result(await Command(owner, path + "/status", new GatheringStatusRequest(Guid.NewGuid(), g.Version, "Cancelled"), "PUT"));
        clock.Now = g.StartAt.AddMinutes(-1); using var scope = host.Services.CreateScope(); await scope.ServiceProvider.GetRequiredService<GatheringService>().DeliverReminders(CancellationToken.None);
        Assert.Null((await member.GetFromJsonAsync<GatheringPreparationDto>(path + "/preparation"))!.Reminder.Minutes);
        Assert.DoesNotContain((await member.GetFromJsonAsync<GatheringNotices>(Root(c) + "/notices"))!.Items, n => n.Kind == "reminder");
    }
}
