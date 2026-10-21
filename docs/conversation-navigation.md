# Conversation navigation

Channel messages and direct messages support one reply source and up to ten explicitly selected members. Use the message action menu to reply or bookmark, and the composer `@` button to choose a mention recipient. Typing an ordinary name does not notify anyone. Replies do not create threads. A reply source must be a live message in the same conversation; mention recipients must currently be allowed to view it. Direct-message blocking continues to prevent new sends in both directions.

References store message/user identifiers rather than copied quotations. The UI resolves the current source through an authorized API, including when a link points outside the latest history page. Edits appear in resolved references; deletion or loss of access makes the source unavailable. The focused source panel offers authorized attachments and deliberate playback without automatically downloading media or loading unbounded history. Conversation recovery invalidates source queries, with normal periodic refresh as a fallback. HTTP permission checks remain authoritative; previously displayed browser content cannot be recalled from a user's memory or screenshots.

## Notifications

Each user can choose **All new messages**, **Mentions and replies**, or **Quiet** for each channel or DM. Channels default to mentions/replies; DMs default to all new messages. The setting affects in-app notification delivery and filters pending alerts when reading the inbox. Existing unread counters are independent. Browser push, email and sounds are not part of this feature.

Sending creates recipient notice references in the same PostgreSQL transaction as the message. Retrying an accepted send does not create another notice. Explicit mentions and a reply to the same author produce one notice. Self-notifications, inaccessible resources and blocked direct contacts are excluded. Edits do not create additional notices. The Notifications page rechecks current source access and preferences; deleted or inaccessible messages are excluded. Dismissal and preference changes use payload-bound request receipts, so retrying an old command cannot restore a newer state.

## Private bookmarks

Bookmarks belong to the signed-in account, with an optional 500-character note and up to eight tags of 24 characters. Tags are normalized to lowercase. The limit is 1000 active bookmarks per account. Search filters private notes and exact tags; it is not a cross-community full-text message search. Results have bounded cursor pagination.

Notes and tags are visible only to their author. A bookmark does not grant source access: its current source is resolved again when listing or opening it. If access is lost or the message is deleted, the user's own note/tags remain and the source is unavailable. The user may still remove that bookmark. Opening a saved message's bookmark editor reads its existing metadata before saving, so adding a bookmark twice does not silently clear an earlier note. Mutations are serialized per account with PostgreSQL advisory transaction locks and payload-bound command receipts; the existing resource locks remain in place for message sends and references.

## Storage and operations

This module adds nullable reply IDs and UUID mention arrays to both message stores, plus conversation preferences, private bookmarks, notification references and command receipts in PostgreSQL. No additional service or external delivery provider is needed. Apply the additive migration before running the new API. Back up the database and private files using the deployment procedure before upgrading. The UI and API are deployed together for the new contracts. Generated TypeScript contracts come from the server's OpenAPI document.
