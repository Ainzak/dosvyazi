# Authorized chat attachments

A message may include one file and an optional text caption. The composer supports selection/removal, validation feedback, sending/retry, and authenticated download. English is the default; Russian guidance is available. Existing message deletion removes attachment access too, including moderator deletion.

## Storage and limits

The API supports nonempty UTF-8 `.txt`, `.png`, `.jpg`/`.jpeg`, and `.pdf` uploads up to 5 MiB. It checks the extension and basic file signature (or strict UTF-8 text/control characters), not the entire format or malware. Original names are limited to 120 characters without paths/control characters; only a generated GUID is used on disk. This is a download-only baseline: no inline preview, executables, archives, HTML, SVG, arbitrary MIME types or multi-file batch.

Files remain outside `wwwroot`. Development defaults to ignored `.local/files`; set `Files__RootPath` to an absolute dedicated persistent directory for other environments. The API process needs read/write permissions, not execute permissions. No public static file mapping is configured. Production Compose mounts `/opt/dosvyazi/data/files` at `/var/lib/dosvyazi/files`; create it with API UID/GID 1654:1654 and mode 700 before an authorized deployment. Existing servers need this directory and the additive migration before updating the API. This documentation does not perform a deployment.

The default stored-blob quota is 512 MiB, configurable through `Files__QuotaBytes`; it includes retained orphan files. Uploads across communities share a PostgreSQL advisory lock for quota checks/file creation. At most two uploads are admitted concurrently per API process before multipart model binding, with no queue; additional requests return 429 and `Retry-After: 2`. Multipart/request bodies are capped at 6 MiB, including overhead. Current limits are engineering defaults, not a measured capacity claim. The filesystem volume must be shared consistently if an operator later runs multiple API instances; such scaling is not introduced here.

## Contract and authorization

All routes start with `/api/v1/communities/{community}/channels/{channel}`:

- `POST /attachments`: multipart `clientMessageId`, `file`, optional `content`; returns 201 with the message and attachment metadata. Cookie authentication, same-origin/CSRF protection, current membership, ViewChannel and SendMessage apply.
- `GET /attachments/{id}`: rechecks current membership and ViewChannel plus attachment/message/channel identity and deletion state. Returns a forced `application/octet-stream` attachment download with `no-store`, `nosniff` and a sandbox policy. No reusable public URL or signed bearer access is issued.

Names and IDs do not grant access. Private-channel denial, nonmembership, ban, leave, deletion and cross-channel references return 404. A visible read-only channel permits downloads but rejects uploads with 403. Validation uses 422, oversized/empty files 413, reused IDs with changed content/file/name 409, unavailable storage 503, and full storage 409. Anonymous API requests return 401; missing CSRF returns 400. The client retains the selected file and request ID after an uncertain send, so retry does not publish a duplicate. File-only messages are allowed; ordinary text-only sends retain their existing behavior.

Metadata, message sequence and outbox entry commit in one database transaction. History/catch-up include attachment metadata; caption edits preserve the blob. Files are written before the metadata transaction commits. An abrupt process exit, write failure or uncertain database acknowledgement can leave a private orphan: it counts against quota and remains for operator review. No automatic orphan deletion risks removing a committed file. These leftover files require a separate, reviewed maintenance procedure; there is no automatic orphan collector in this milestone.

Message deletion immediately denies new download requests. A background task retries physical deletion of known deleted-message blobs every 30 seconds in batches of 100 and records completion. `Files__WorkerEnabled=false` disables it for isolated fixtures; failed cleanup is retried after restart. Already downloaded bytes or a transfer authorized before a permission change cannot be recalled. Back up PostgreSQL and the private file directory together, retaining Data Protection keys separately. A missing blob is a storage failure, not silently an empty download.

This milestone supplies bounded authenticated downloads for a controlled test installation. Signature validation does not replace a malware scanner. A public untrusted-upload rollout should define scanning/quarantine policy before broad access. No scanner, paid service or third-party asset import is installed. The implementation uses existing .NET 10 upload facilities; see [Microsoft upload guidance](https://learn.microsoft.com/en-us/aspnet/core/mvc/models/file-uploads?view=aspnetcore-10.0).
