# Text messaging

An active community member can send plain-text messages in its general channel, load older history and recover messages after reconnecting. Owner bans and member departure deny new reads, sends and subscriptions. Editing, deletion, files, reactions, typing, presence and additional channel permissions belong to later slices.

## HTTP contracts

All routes below use `/api/v1/communities/{communityId}/channels/{channelId}`. IDs and sequences are strings in responses. Every request validates the current cookie session; resource queries require active membership and matching channel/community IDs. Mutations also require the identity-bound `X-CSRF-TOKEN` from `/api/v1/account/csrf`, same-origin requests and the shared account-level community command limit of 60/minute.

| Route | Behavior |
| --- | --- |
| `POST /messages` | `{ clientMessageId, content }`; returns persisted message with HTTP 201, including on an identical retry |
| `GET /messages` | Latest 50 messages, ascending sequence, snapshot watermark and `hasOlder` |
| `GET /messages?before=sequence` | Previous 50 messages using exclusive keyset pagination |
| `GET /events?after=sequence` | Next 100 versioned journal events, `nextSequence`, watermark and `hasMore` |

Content contains 1–4000 UTF-16 code units, must contain non-whitespace text and may include newlines/tabs but no other control characters. The browser renders it as escaped text, without interpreting HTML. Sender and timestamps come from the server. Unique `(authorId, channelId, clientMessageId)` binds retries to exact content; changing text under the same key returns 409. Different authors may use the same client ID. A successful response confirms persistence, not receipt or reading by every participant.

Invalid cursors return 400, outsiders/banned members and mismatched resource IDs return 404, and anonymous/invalid sessions return 401. A nonzero recovery cursor older than seven days returns 409; the browser reloads a snapshot. This slice retains journal/outbox records and does not perform a destructive retention purge. Production retention and content-deletion policies are later work.

## Persistence and live recovery

A Read Committed transaction locks the community first, then the channel counter, checks membership, and saves the message, channel event and outbox entry together. Membership changes share the community lock. Sequences order concurrent writes; a rolled-back write consumes no committed sequence. The current community-wide writer lock is conservative; its contention/capacity has not been measured.

The in-process worker checks pending durable outbox entries every 500 ms, at most 32 per pass. It checks current membership and session/stamp/expiry for each explicitly registered local connection under the community lock before publishing, then marks the entry published. Failures retain it for retry. An enqueue followed by a marking failure can produce repeated notifications. No exactly-once delivery is promised. No connected recipients is a valid publication outcome: clients recover through HTTP.

`/hubs/messages` authenticates cookies and requires an explicit exact same Origin for every transport, including WebSocket GET upgrades. The browser uses WebSockets directly, without fallback transports. `Subscribe(communityId, channelId)` reauthorizes both session and membership, with one channel per connection. Subscription attempts are limited to 12/minute per connection. There are at most eight subscribed connections per account and 500 per process. Limits apply to subscribed connections, not all unauthenticated network sockets; production ingress limits remain necessary. No SignalR group grants authority.

The version-1 `ChannelChanged` hint contains `eventId`, `channelId`, `sequence`, `kind` and `schemaVersion`; it contains no message body or author. Receiving it triggers an authorized HTTP journal query. Journal events add a `payload` with the current message representation. Hints can repeat or arrive out of order; the client merges persistent message IDs and advances only its HTTP recovery cursor. Initial subscription and reconnect both trigger catch-up, closing the snapshot/subscription gap. Browser offline events stop the live connection and show Offline; online events restart and reauthorize it. HTTP polling every 15 seconds/on focus provides additional recovery if a hint is missed.

The worker also reconciles subscribed sessions/memberships each pass and aborts invalid connections. Database unavailability stops publication; the worker retries. Already delivered information and in-flight responses cannot be recalled. A hint already enqueued before revocation may still arrive, but it carries no content and a later unauthorized HTTP request is denied. Private cache keys include the account, community and channel; account switches/access denial remove private cache. Transient background session/community/channel errors show retry warnings while preserving the loaded workspace and draft; actual unauthorized responses still clear access. Loading an older page never recreates a removed cache entry.

This implementation supports one application process, matching the initial architecture. Multiple hosts share command consistency through PostgreSQL, but they do not share live connection routing; horizontal live delivery needs a separately approved routing/backplane design. Durable HTTP catch-up works independently of live routing. No performance or delivery-time guarantee has been measured.

## Verification and references

`npm run test:database` uses real PostgreSQL and raw SignalR WebSockets for ordering/retries, atomic message/event/outbox persistence, restart recovery, keyset/cursor behavior, negative authorization, Origin enforcement, ban/session revocation and controlled ban/write locking. `npm run test:e2e` checks two-user live updates, safe text, lost-response retry, offline catch-up, cache removal after a ban and loading/retry states at desktop/mobile sizes. Synthetic fixtures and artifacts remain local.

Design guidance: [SignalR browser client and reconnect](https://learn.microsoft.com/en-us/aspnet/core/signalr/javascript-client?view=aspnetcore-10.0), [SignalR security and WebSocket Origin](https://learn.microsoft.com/en-us/aspnet/core/signalr/security?view=aspnetcore-10.0), [users/groups and authorization](https://learn.microsoft.com/en-us/aspnet/core/signalr/groups?view=aspnetcore-10.0), [EF Core keyset pagination](https://learn.microsoft.com/en-us/ef/core/querying/pagination).
