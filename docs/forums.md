# Forums and message threads

The product uses distinct terms:

| English | Russian | Entry point |
| --- | --- | --- |
| Text channel | Текстовый канал | Ordinary chat timeline |
| Message thread | Ветка сообщения | Branch from a message in a text channel |
| Forum | Форум | Community channel containing a topic directory |
| Forum topic | Тема форума | Named discussion created with its own first post |

Community managers create a forum using **Manage access → New forum → Add forum → Save access**. It appears under **Forums**, separately from text channels. Existing channel types cannot be converted. The forum inherits the same role/category/resource permission model as other channels. View permits reading its topics; SendMessage permits topic creation and posting. A forum has no direct message timeline: raw message APIs reject its container ID.

Create a topic with a2–80-character title and a first text post up to4000 characters. Creation and the first post commit atomically. Subsequent messages use existing chat features, including private files, voice messages, stickers, reactions, replies, mentions, search, read positions, notification preferences and bookmarks. Topics have their own unread state. There are up to1000 lifetime topics per forum and50 directory entries per page, with optional title search and archived view. These are safeguards, not measured capacity.

The topic creator with current SendMessage or a message moderator may rename/archive/reopen it using the reviewed version. Archived topics remain readable but reject sending, editing and reactions even from the owner. Moderation deletion remains available. Exact command retries return current authorized state and never reapply an obsolete archive action. Removing access to the forum also closes its topics, history, files, source links and subscriptions. There are no nested threads/topics or per-topic private membership.

Forum endpoints are under `/api/v1/communities/{community}/forums/{forum}/topics`: `GET` directory, `POST` with `{clientRequestId,title,content}`, `GET /{topic}` and `PUT /{topic}` with `{clientRequestId,expectedVersion,title,archived}`. Source links use `/communities/{community}/forums/{forum}/topics/{topic}?message={message}`. Message-thread URLs and API contracts remain unchanged.

The existing PostgreSQL channel table has explicit Text/Forum/MessageThread/ForumTopic kinds. Shared application metadata uses Discussion names; legacy physical Thread column names remain mapped to preserve data and migration compatibility. Existing child rows are backfilled as MessageThread. Strict metadata checks distinguish root-backed message threads from rootless forum topics. Configuration templates retain the optional top-level channel kind (`Text` by default for older version1 files), but exclude topics, thread titles and message content. Restoring a configuration creates empty forums with new IDs.

See [message threads](message-threads.md) for branching from chat and [community configuration](community-configuration.md) for export boundaries. A forum topic is never presented as a message thread in navigation, creation, settings or archive states.
