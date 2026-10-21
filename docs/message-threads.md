# Message threads

A message in an ordinary community text channel can start one named discussion. Use **Start thread** in the message actions, or open an existing badge. **Channel threads** lists active discussions; select **Show archived threads** to find closed ones. Titles contain 2–80 characters. Threads are visible to everyone who can view the parent channel.

Replies use the existing chat UI: text, authorized attachments, voice messages, stickers, reactions, replies, explicit mentions, private bookmarks, search and notification preferences. History, search, read position and unread counts belong to the thread, independently of the parent conversation. Following a bookmark or notification opens the thread and the referenced message. SPA navigation preserves the current voice connection.

The creator with current parent SendMessage permission, or a parent message moderator, can rename, archive or reopen the thread. Saving settings requires the reviewed version. A stale editor keeps its draft and asks the user to close and reopen settings before applying changes to the latest version. Archiving preserves readable history and prevents new messages, edits and reactions, including from the owner; moderation deletion remains available. Deleting the original message preserves the discussion and shows a removed-source placeholder rather than a copied quotation.

## Access and persistence

Every HTTP request, attachment/preview download, search, source lookup and live subscription resolves the current parent channel permissions. Threads have no independent membership or permission overrides. Category/channel policy changes, leaving, kicks and bans apply to threads as well. Client badges and SignalR groups never grant access.

The API stores a thread as a child TextChannel with a parent, root message, creator, creation time, archive flag, version and per-parent sequence. Composite foreign keys enforce matching community/parent/root associations; strict metadata constraints and unique indexes enforce one thread per root. The shared community lock serializes creation, management, message operations and access changes. Durable actor/payload-bound command receipts make retries safe. Replaying an old successful settings request returns the current authorized state without overwriting a later change.

Ordinary channel navigation, access-policy editing and version 1 community configuration export/restore exclude child conversations. Saving an ordinary policy retains existing threads and rejects attempts to configure a child as a normal channel. Configuration templates contain no thread titles, roots, history or read positions.

## API and bounds

Authenticated, no-store endpoints under `/api/v1/communities/{community}/channels/{parent}/threads`:

- `GET`: active threads by default; `archived=true`, optional title `query` up to 80 characters, and exclusive sequence `before` cursor. Up to 50 threads per page.
- `GET ?roots=...`: badges for up to 100 root message IDs, including archived threads.
- `POST`: `{ clientRequestId, rootMessageId, title }`, requiring current parent View and SendMessage and a live root.
- `GET /{thread}`: current metadata and capabilities.
- `PUT /{thread}`: `{ clientRequestId, expectedVersion, title, archived }`; stale versions or reused IDs with different payloads return 409.

Creation is limited to 1000 lifetime threads per parent channel. Thread message operations reuse the existing channel message/file endpoints with the child ID, including 50-message server pages and a 100-row mounted history window. These bounds are safeguards, not measured capacity claims. Thread metadata refreshes by polling; messages use existing SignalR hints and revision-aware HTTP recovery.

Canonical browser routes are `/communities/{community}/channels/{parent}/threads` and `/communities/{community}/channels/{parent}/threads/{thread}?message={message}`. Nested threads, threads in DMs, automatic archival and thread deletion are unavailable. [Forums](forums.md) provide a separate topic directory and independent first posts; they are not message threads.

## Upgrade

The MessageThreads migration preserves existing normal channels and messages. Their new metadata receives safe defaults; the ordinary-channel name index becomes filtered so thread titles can repeat. Apply migrations using the documented deployment process and retain a coherent private database/files backup. After thread creation, older application versions that do not understand inherited thread access are not safe rollback targets. Prefer a forward fix; restoring an older database backup requires a separate, explicitly reviewed recovery operation.
