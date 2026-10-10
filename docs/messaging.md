# Text messaging

An authorized member can send plain-text messages in accessible channels, load older history and recover after reconnecting. Authors can edit/delete their messages while sending is allowed; ManageMessages permits deleting other authors' messages, with current viewing access still required. Files, reactions, typing and presence belong to later slices. See [access rules](text-access.md).

## HTTP contracts

All routes below use `/api/v1/communities/{communityId}/channels/{channelId}`. IDs and sequences are strings in responses. Every request validates the current cookie session; resource queries require active membership and matching channel/community IDs. Mutations also require the identity-bound `X-CSRF-TOKEN` from `/api/v1/account/csrf`, same-origin requests and the shared account-level community command limit of 60/minute.

| Route | Behavior |
| --- | --- |
| `POST /messages` | `{ clientMessageId, content }`; returns persisted message with HTTP 201, including on an identical retry |
| `GET /messages` | Latest 50 messages, ascending sequence, snapshot watermark and `hasOlder` |
| `GET /messages?before=sequence` | Previous 50 messages using exclusive keyset pagination |
| `GET /events?after=sequence` | Next 100 versioned journal events, `nextSequence`, watermark and `hasMore` |
| `PUT /messages/{id}` | `{ clientRequestId, expectedVersion, content }`; author edit with optimistic revision |
| `POST /messages/{id}/delete` | `{ clientRequestId, expectedVersion }`; author/moderator deletion |

Content contains 1–4000 UTF-16 code units, must contain non-whitespace text and may include newlines/tabs but no other control characters. The browser renders it as escaped text, without interpreting HTML. Sender and timestamps come from the server. Unique `(authorId, channelId, clientMessageId)` binds retries to exact content; changing text under the same key returns 409. Different authors may use the same client ID. A successful response confirms persistence, not receipt or reading by every participant.

Invalid cursors return 400, outsiders/banned members, hidden channels and mismatched resources return 404, and anonymous/invalid sessions return 401. A recovery cursor outside the seven-day window returns 409; cursor zero also expires if the journal contains older events. The browser reloads a snapshot. Journal/outbox records remain retained; no destructive retention purge or bounded-storage claim is made.

Creation sequence fixes a message's position. Edits/deletes advance a separate channel event sequence and per-message version. Concurrent stale changes return 409; exact command retries return the originally applied version and current representation without another event/audit record. A send retry after editing/deleting checks the original content hash and returns the current representation, not the former body. Deletion clears stored content and removes the message from history. An original-content hash remains for retry identity; backups and content already delivered are not erased by this operation.

## Persistence and live recovery

A Read Committed transaction locks the community first, then the channel counter, checks membership, and saves the message, channel event and outbox entry together. Membership changes share the community lock. Sequences order concurrent writes; a rolled-back write consumes no committed sequence. The current community-wide writer lock is conservative; its contention/capacity has not been measured.

The in-process worker checks pending durable outbox entries every 500 ms, at most 32 per pass. It checks current membership and session/stamp/expiry for each explicitly registered local connection under the community lock before publishing, then marks the entry published. Failures retain it for retry. An enqueue followed by a marking failure can produce repeated notifications. No exactly-once delivery is promised. No connected recipients is a valid publication outcome: clients recover through HTTP.

`/hubs/messages` authenticates cookies and requires an explicit exact same Origin for every transport, including WebSocket GET upgrades. The browser uses WebSockets directly, without fallback transports. `Subscribe(communityId, channelId)` reauthorizes both session and membership, with one channel per connection. Subscription attempts are limited to 12/minute per connection. There are at most eight subscribed connections per account and 500 per process. Limits apply to subscribed connections, not all unauthenticated network sockets; production ingress limits remain necessary. No SignalR group grants authority.

The version-1 `ChannelChanged` hint contains `eventId`, `channelId`, `sequence`, `kind` and `schemaVersion`; it contains no body or author. It triggers an authorized HTTP journal query. Journal events include message ID/version and a current representation for undeleted messages. Every event referring to a deleted message instead returns `message.deleted` with null payload, so recovery cannot replay its former text. Hints may duplicate or arrive out of order. The client applies contiguous HTTP event sequences, keeps highest message versions and deletion tombstones, and reloads a snapshot for gaps or unsupported schemas/kinds. It discards an older pagination response whose watermark predates the current feed, preventing resurrection after concurrent deletion. Initial subscription/reconnect both catch up. Offline/online events stop/restart the connection; polling every 15 seconds/on focus provides fallback recovery.

The worker also reconciles subscribed sessions/memberships each pass and aborts invalid connections. Database unavailability stops publication; the worker retries. Already delivered information and in-flight responses cannot be recalled. A hint already enqueued before revocation may still arrive, but it carries no content and a later unauthorized HTTP request is denied. Private cache keys include the account, community and channel; account switches/access denial remove private cache. Transient background session/community/channel errors show retry warnings while preserving the loaded workspace and draft; actual unauthorized responses still clear access. Loading an older page never recreates a removed cache entry.

This implementation supports one application process, matching the initial architecture. Multiple hosts share command consistency through PostgreSQL, but they do not share live connection routing; horizontal live delivery needs a separately approved routing/backplane design. Durable HTTP catch-up works independently of live routing. No performance or delivery-time guarantee has been measured.

## Verification and references

`npm run test:database` uses real PostgreSQL and raw SignalR WebSockets for ordering/retries, atomic message/event/outbox persistence, restart recovery, keyset/cursor behavior, negative authorization, Origin enforcement, ban/session revocation and controlled ban/write locking. `npm run test:e2e` checks two-user live updates, safe text, lost-response retry, offline catch-up, cache removal after a ban and loading/retry states at desktop/mobile sizes. Synthetic fixtures and artifacts remain local.

Design guidance: [SignalR browser client and reconnect](https://learn.microsoft.com/en-us/aspnet/core/signalr/javascript-client?view=aspnetcore-10.0), [SignalR security and WebSocket Origin](https://learn.microsoft.com/en-us/aspnet/core/signalr/security?view=aspnetcore-10.0), [users/groups and authorization](https://learn.microsoft.com/en-us/aspnet/core/signalr/groups?view=aspnetcore-10.0), [EF Core keyset pagination](https://learn.microsoft.com/en-us/ef/core/querying/pagination).
