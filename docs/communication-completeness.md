# Reactions, search, read state, emoji and profiles

These M5 features extend the existing authenticated controller API, PostgreSQL model and responsive English/Russian UI. No broker, search server, object store or new dependency is introduced.

## Reactions and emoji

Each message exposes reaction counts and whether the current user reacted; other reacting users' account details are not exposed. The initial standard set is 👍, ❤️, 😂, 🎉, 😮 and 😢. `PUT .../channels/{channel}/messages/{message}/reaction` takes `clientRequestId`, `emoji`, `active`. Current View/Send permissions apply. Requests are payload-bound and idempotent; a retry of an earlier command cannot undo a later removal. A changed intent gets a new ID. The UI offers Retry reaction after an uncertain response. A message holds at most 256 user/reaction entries.

Reaction changes advance message version/channel event sequence and publish through the existing outbox. Authorized live hints and catch-up refresh the current personalized payload. Editing concurrently with a reaction may return the existing version-conflict response. Deletion makes reactions unavailable through the user API.

Community custom emoji are managed under `GET/POST /api/v1/communities/{community}/emoji`, `POST /{id}/delete` and `GET /{id}/image`. Active members can list/view; the owner or a role with ManageRoles can upload/remove. Images are private PNG blobs using the attachment volume/quota and cleanup mechanism, maximum 256 KiB and 256 by 256 pixels. PNG signature/IHDR dimensions are checked; this is not full decoding or malware scanning. Up to 32 active emoji per community. Names use 2–32 lowercase ASCII letters/digits/underscores; retired names cannot be reused to substitute new artwork into historical text. Creation uses a payload-bound request ID; creation/removal is audited. Current membership is checked on every image request, with no-store/nosniff and no public static URL.

The composer inserts standard characters or custom `:name:` aliases. Message text safely renders available aliases as authenticated PNG images; unknown/removed aliases remain plain text. Custom reactions use stable `custom:<uuid>` IDs, are restricted to that community and remain removable by their author after the emoji is retired. Cached/downloaded images cannot be recalled after removal or permission revocation.

## Search and read state

The channel UI searches current visible messages with `GET .../channels/{channel}/search?query=<text>&before=<sequence>`. Search rechecks current membership/ViewChannel under the same community/channel locks as history. Hidden, banned and unrelated users receive 404. Results exclude deleted messages, use the current edited caption, and include current attachment/reaction metadata. Search is limited to the selected accessible channel; it does not search file contents, retired history, profiles or other communities.

PostgreSQL maintains a generated `tsvector` and GIN index over message text. The `simple` configuration and parameterized `plainto_tsquery` match multilingual word tokens without language-specific stemming or advanced query syntax. Maximum query length 200, page size 25 with sequence-based older-results pagination. Results render as plain text, avoiding HTML search-headline injection. This baseline has functional checks, not a load or search-quality benchmark. See [Npgsql full-text mapping](https://www.npgsql.org/efcore/mapping/full-text-search.html) and [PostgreSQL search controls](https://www.postgresql.org/docs/18/textsearch-controls.html).

`GET/PUT .../channels/{channel}/read-state` returns the user's sequence and unread count; PUT takes `sequence`. The server verifies the current channel watermark and only advances positions, including concurrent/repeated requests. Deleted messages and the user's own sends do not count as unread. Read positions and counts are private to the current account, not public read receipts. Mark as read is explicit: opening a channel or fetching older history does not claim it was read. Navigation badges refresh every 15 seconds, the open channel's counter every 10 seconds; explicit marking updates immediately. Edits/reactions do not turn previously read messages into new unread messages.

## Profiles and settings

`GET /api/v1/profiles/{user}` returns display name, About, Interests, Games and LookingFor. The user approved visibility to any signed-in account, regardless of shared community. Email, password hashes, sessions/security stamps and community membership are excluded. Anonymous requests receive 401; unknown profiles 404. Message author/member links open the profile; account settings link to the owner's editor.

`PUT /api/v1/profiles/me` edits only the authenticated account's plain-text fields. About is limited to 1000 characters; Interests/Games/LookingFor each to 500. Games and interests are manually entered; no asset catalog, scraping, activity tracking or matchmaking. Empty fields have a visible placeholder. Existing display-name editing and new detail updates share a database writer lock so concurrent saves preserve separate fields. Both use current authentication/CSRF/same-origin protection. Profile/query caches are keyed by viewer identity and cleared across session changes.

Existing invitation management, account display-name/password recovery, interface language and saved voice output-volume settings complete their corresponding M5 baseline workflows. Voice recordings, redesigned visuals and broader profile/catalog imports remain separate future assignments. The metadata migration is additive; normal startup still does not migrate automatically. Shared deployment requires explicit authorization and the documented private-file directory ownership and backups.
