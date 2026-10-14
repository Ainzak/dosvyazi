using System.Security.Cryptography;
using System.Text;
using App.Api.Features.Communities;

namespace App.Api.Features.Messages;

public sealed record PreparedAttachment(string Name, byte[] Bytes, string Hash, string Kind = "File", string? ContentType = null, int? DurationMs = null, string? InputHash = null);

public sealed class AttachmentStore(IConfiguration configuration, IWebHostEnvironment environment)
{
    public const int MaxBytes = 5 * 1024 * 1024;
    public const long DefaultQuotaBytes = 512L * 1024 * 1024;
    public long QuotaBytes => configuration.GetValue("Files:QuotaBytes", DefaultQuotaBytes);
    private string Root
    {
        get
        {
            var configured = configuration["Files:RootPath"];
            if (string.IsNullOrWhiteSpace(configured) && !environment.IsDevelopment())
                throw new InvalidOperationException("Configure private persistent Files:RootPath.");
            var root = Path.GetFullPath(configured ?? Path.Combine(environment.ContentRootPath, "../../..", ".local", "files"));
            var publicRoot = Path.GetFullPath(environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"));
            if (root.Equals(publicRoot, StringComparison.OrdinalIgnoreCase) || root.StartsWith(publicRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Attachment storage must be outside the public web root.");
            Directory.CreateDirectory(root);
            return root;
        }
    }
    public static async Task<PreparedAttachment> PrepareAsync(IFormFile file, CancellationToken ct)
    {
        var name = file.FileName;
        if (name.Length is < 1 or > 120 || name.Any(c => char.IsControl(c) || c is '/' or '\\' or ':' ) || name is "." or "..")
            throw new CommunityFailure(422, "Use a filename without paths or control characters, up to 120 characters.");
        if (file.Length is < 1 or > MaxBytes) throw new CommunityFailure(413, "Choose a nonempty file up to 5 MiB.");
        await using var input = file.OpenReadStream();
        using var output = new MemoryStream();
        var buffer = new byte[81920]; int count;
        while ((count = await input.ReadAsync(buffer, ct)) > 0)
        {
            if (output.Length + count > MaxBytes) throw new CommunityFailure(413, "Choose a nonempty file up to 5 MiB.");
            output.Write(buffer, 0, count);
        }
        var bytes = output.ToArray();
        var extension = Path.GetExtension(name).ToLowerInvariant();
        var valid = extension switch
        {
            ".png" => bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
            ".jpg" or ".jpeg" => bytes.AsSpan().StartsWith(new byte[] { 255, 216, 255 }),
            ".pdf" => bytes.AsSpan().StartsWith("%PDF-"u8),
            ".txt" => ValidText(bytes),
            _ => false,
        };
        if (!valid) throw new CommunityFailure(422, "Supported files: UTF-8 TXT, PNG, JPEG and PDF with a matching file signature.");
        return new(name, bytes, Convert.ToHexStringLower(SHA256.HashData(bytes)));
    }
    private static bool ValidText(byte[] bytes)
    {
        try { return new UTF8Encoding(false, true).GetString(bytes).All(c => !char.IsControl(c) || c is '\n' or '\r' or '\t'); }
        catch (DecoderFallbackException) { return false; }
    }
    public static async Task<PreparedAttachment> PrepareVoiceAsync(IFormFile file, CancellationToken ct)
    {
        if (file.Length is < 1 or > VoiceMessageMedia.MaxBytes) throw new CommunityFailure(413, "Choose a voice recording up to 2 MiB.");
        await using var input = file.OpenReadStream(); using var output = new MemoryStream();
        var buffer = new byte[81920]; int count;
        while ((count = await input.ReadAsync(buffer, ct)) > 0)
        {
            if (output.Length + count > VoiceMessageMedia.MaxBytes) throw new CommunityFailure(413, "Choose a voice recording up to 2 MiB.");
            output.Write(buffer, 0, count);
        }
        var original = output.ToArray(); var validated = VoiceMessageMedia.Validate(original);
        return new("voice-message.webm", validated.Bytes, Convert.ToHexStringLower(SHA256.HashData(validated.Bytes)), "Voice", "audio/webm;codecs=opus", validated.DurationMs,
            Convert.ToHexStringLower(SHA256.HashData(original)));
    }
    private string FilePath(Guid id) => Path.Combine(Root, id.ToString("N") + ".blob");
    public long UsedBytes() => Directory.EnumerateFiles(Root, "*.blob").Where(p => Guid.TryParseExact(Path.GetFileNameWithoutExtension(p), "N", out _)).Sum(p => new FileInfo(p).Length);
    public async Task WriteAsync(Guid id, byte[] bytes, CancellationToken ct)
    {
        await using var file = new FileStream(FilePath(id), FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.Asynchronous);
        await file.WriteAsync(bytes, ct);
        await file.FlushAsync(ct);
    }
    public Stream Open(Guid id) => new FileStream(FilePath(id), FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
    public void Remove(Guid id) => File.Delete(FilePath(id));
}
