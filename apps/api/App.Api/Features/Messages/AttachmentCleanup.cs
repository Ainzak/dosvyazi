using App.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace App.Api.Features.Messages;

// Deleted-message blobs are retried after failures/restarts. Unknown crash-orphan
// blobs are retained and count against quota until an operator reviews them.
public sealed class AttachmentCleanup(IServiceScopeFactory scopes, ILogger<AttachmentCleanup> logger, IConfiguration configuration) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!configuration.GetValue("Files:WorkerEnabled", true)) return;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                await PurgeAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), scope.ServiceProvider.GetRequiredService<AttachmentStore>(), ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch { logger.LogWarning("Attachment cleanup failed; pending deletions will be retried."); }
            try { await Task.Delay(TimeSpan.FromSeconds(30), ct); } catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
        }
    }
    public static async Task PurgeAsync(AppDbContext db, AttachmentStore store, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(73421891)", ct);
        var pending = await db.MessageAttachments.Where(a => a.Message.Deleted && !a.Purged).Take(100).ToArrayAsync(ct);
        foreach (var item in pending) { store.Remove(item.Id); item.Purged = true; }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }
}
