using System.Globalization;
using System.Text;

namespace App.Api.Features.Gatherings;

public static class GatheringCalendar
{
    public static string Export(Gathering g, DateTimeOffset now)
    {
        static string Date(DateTimeOffset d) => d.UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
        static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\r\n", "\n").Replace("\r", "\n").Replace("\n", "\\n").Replace(";", "\\;").Replace(",", "\\,");
        var lines = new[] { "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dosvyazi//Gatherings//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
            $"UID:{g.Id:D}@dosvyazi", "DTSTAMP:" + Date(now), "DTSTART:" + Date(g.StartAt), "SEQUENCE:" + g.Version.ToString(CultureInfo.InvariantCulture),
            "SUMMARY:" + Escape(g.Title), "STATUS:" + (g.Status == "Cancelled" ? "CANCELLED" : "CONFIRMED"), "END:VEVENT", "END:VCALENDAR" };
        var output = new StringBuilder();
        foreach (var line in lines)
        {
            var bytes = 0;
            foreach (var rune in line.EnumerateRunes())
            {
                if (bytes + rune.Utf8SequenceLength > 75) { output.Append("\r\n "); bytes = 1; }
                output.Append(rune.ToString()); bytes += rune.Utf8SequenceLength;
            }
            output.Append("\r\n");
        }
        return output.ToString();
    }
}
