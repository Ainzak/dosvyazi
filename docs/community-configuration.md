# Community rights and portable configuration

The community overview includes **Explain access**. A member can inspect their saved permissions on resources they can currently view. Inspecting another active member requires both ManageRoles and ManageChannels, plus the inspecting actor's own resource visibility. Hidden/missing resources return the same 404. The explanation uses the same resolver as message/voice authorization under the community lock; it shows role grants, category/resource allows/denies, owner override and required prerequisite bits. It is a current policy explanation, not a guarantee that a particular moderation target, session or device is usable. Rank and action-specific restrictions remain enforced separately.

## Export boundaries

Only the current owner can download the complete configuration: a manager may lack private-resource access. The JSON contains community name, role definitions/grants/ranks, categories, ordinary text channels, forums and category/channel/voice rules. Private channel/category/role names are present; share deliberately. Accounts, memberships, assigned roles, invites/codes, message history/files, message threads, forum topics, Gatherings, audit and active voice leases are excluded. This is a template, not a backup. Use operator database/files backups for data recovery.

Version 1 has `format: "dosvyazi-community"`, `version: 1` and `everyoneRoleId`, with bounded arrays `roles`, `categories`, `channels`, `categoryRules`, `channelRules`, `voiceRules`, plus nullable `voiceCategoryId`. IDs represent internal references in the file; they do not authorize access to their original resources. Only names, grants, ranks and rules are portable. Unknown fields at any depth, unsupported versions/permissions, null entries, duplicate IDs/rules or invalid references are rejected. Existing policy limits apply: 20 roles, 20 categories, 50 channels, 400 category rules, 1000 channel rules, 20 voice rules; JSON requests are limited to 256 KiB.

Each top-level channel accepts optional `kind: "Text" | "Forum"`; omission in older version1 templates means Text. Restoration preserves the type and creates empty forums. Child message threads/topics cannot be imported as top-level resources. Older application versions may reject newer templates containing `kind`; forward compatibility is not promised.

## Review and isolated restore

On **Communities**, choose **Create from configuration**, select the JSON, inspect the server-validated names/rules and enter a new name. Confirmation creates a **new** community owned by the signed-in user, with only that user as a member. Every community, role, category and channel ID is replaced and references remapped. No member-role assignments or content are imported. Source and existing communities are never modified. Review permissions before inviting people; roles are initially unassigned, and the owner retains the normal owner override.

Restores are atomic PostgreSQL transactions. The existing owner/request unique index and durable access receipt bind the request to actor, operation and normalized document/name hash. Concurrent identical retries return the same new community; reuse with another payload returns 409. No new database migration, store or external dependency is needed. Preview does not persist data. Possessing a template permits creation, not source membership or access.

## API

Authenticated reads are no-store. Commands require current session, CSRF and the existing community command rate limit.

- `GET /api/v1/communities/{id}/rights?kind=text&channelId=...&userId=...`: omit userId for self; kind voice does not need channelId.
- `GET /api/v1/communities/{id}/configuration`: owner-only v1 document.
- `POST /api/v1/communities/configuration/preview`: `{ configuration: <document> }`; normalized validation result only.
- `POST /api/v1/communities/configuration/restore`: `{ clientRequestId, name, configuration }`; 201 `{ communityId }`, including exact replay.
