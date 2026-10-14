# Direct messages

Any signed-in account can immediately start a one-to-one conversation from another user's profile or a shared profile link/user ID in Messages. Shared community membership and request acceptance are not required. Account emails remain private. Each conversation has exactly two immutable participants and a unique normalized pair; repeated/concurrent creation returns that same conversation.

The inbox and conversation support plain text, live updates with history recovery, bounded older pages, private unread state, normal attachments/image viewing and recorded voice messages. Mark as read updates only the caller's state; there are no public read receipts or presence tracking. An unconfirmed send retains its draft and command ID for an exact retry. Text and captions can be edited/deleted by their author with version checks; community management permissions grant no DM access. A message deletion hides its content and denies new file requests, while private physical-file cleanup is retried by the existing worker.

Block direct contact prevents new messages, edits and attachments in both directions. Existing participants retain their earlier history and downloads. Either participant may remove their own block; an old retried block/unblock command cannot overwrite newer intent. Blocking here does not change community membership or community voice permissions. Leaving or being banned from a community does not remove global DM participation. Group DMs and DM voice/video calls are not implemented.

## Server boundaries

Controller routes live under `/api/v1/direct-messages`; `/hubs/direct-messages` supplies content-free change hints. Every HTTP operation checks the authenticated database session and explicit participation. Downloads additionally require a matching conversation attachment and a nondeleted message. A third account cannot enumerate another inbox cursor, read history/events/files, mutate or subscribe to a conversation. SignalR groups are not used as authorization: each publication checks current sessions and participants, and revoked sessions are removed/aborted. Browser hub transports require exact same-origin headers; mutations require identity-bound CSRF tokens.

Database account locks in UUID order serialize creation, blocking, writes and publications across hosts; conversation locks serialize message ordering and version changes. This ordering also coordinates session logout/password reset. Messages, commands and a durable change journal/outbox use PostgreSQL; media reuses the existing private filesystem store, quota and upload concurrency gate. No additional database, broker, object store or external service is introduced.

The default limits are 12 conversation-start attempts, 60 command attempts and 120 read-state attempts per account/minute. A serialized database check also caps new DM messages at 60/account/minute across text and media routes. Inbox/history pages contain up to 50 items; journal catch-up pages contain 100 events. Old journal cursors request a fresh snapshot after seven days. Retries are payload-bound, including original voice recording bytes, and mutations recheck blocking after waiting for locks.

The UI subscribes to its own inbox/selected conversation and recovers through authorized HTTP, with a five-second fallback refresh. Normal connection establishment stays quiet; offline/interrupted updates show an explanation and a manual check action. There is no end-to-end encryption: access is enforced by the application, while HTTPS protects transport. Operator database/file access remains outside participant UI permissions.

## Verification and deployment

Apply the additive `DirectMessages` migration before starting this API version. Back up PostgreSQL, private files and Data Protection keys together. `DirectMessages__WorkerEnabled=false` disables hint delivery for isolated fixtures; durable history remains available. Normal operator deployments keep it enabled. See [development checks](development.md) and [private media limits](attachments.md).

PostgreSQL tests exercise unique pairs, repeated sends/changes, blocking/retry order, private media/deletion, version conflicts, personal unread state, bounded pagination, third-account HTTP/hub denial, exact origin and revoked-session delivery. Browser tests use synthetic accounts/audio to exercise profile entry, live exchange, retries/offline recovery, files, voice messages and both UI languages at desktop/mobile sizes. Physical devices and remote friend acceptance remain separate checks.
