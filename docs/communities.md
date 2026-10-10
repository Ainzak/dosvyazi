# Communities and channel access

Signed-in users can create communities and join by invitation at `/communities`. Creation atomically adds the owner as an active member and creates one `general` text channel. The workspace supports authorized text messaging, voice and additional/private resources.

Owners and delegated roles manage resources according to access and hierarchy rules in text-access.md. Members can leave; invitation/kick/ban permissions remain separate. Ownership transfer and resource deletion are unavailable. There are no global Identity roles granting access to community resources.

## Contract

All paths below start with `/api/v1/communities`, require a valid account session, and disable response caching. Mutations also require the existing antiforgery cookie and `X-CSRF-TOKEN`; browser Origin validation applies. UUIDs are strings in responses. DTOs never return account email/password/session fields or stored invitation hashes/protected codes.

| Method/path | Result |
| --- | --- |
| `GET /` | Communities where the current user is an active member, with their Owner/Member capability |
| `POST /` | `{ clientRequestId, name }`; atomically creates the community, owner membership and channel; 201 details |
| `GET /{id}` | Active-member details and accessible channel summaries; 200 |
| `GET /{id}/channels/{channelId}` | Active-member channel metadata, bound to this community; 200 |
| `POST /{id}/invites` | ManageInvites: `{ clientRequestId, lifetimeHours, maxUses }`; 201 metadata and invitation code |
| `GET /{id}/invites` | ManageInvites metadata: IDs, expiry, maximum/consumed uses and revocation state |
| `POST /{id}/invites/{inviteId}/revoke` | ManageInvites, repeat-safe revocation; 200 metadata |
| `POST /join` | `{ code }`; accepts a usable invitation; 200 community details |
| `GET /{id}/members` | ManageRoles, KickMembers or BanMembers: member IDs, display names and Active/Banned/Left state |
| `PUT /{id}/members/{memberId}/ban` | BanMembers and hierarchy: `{ banned }`; 200 member state |
| `POST /{id}/leave` | Nonowner member leaves; repeated leave is safe; 200 `true` |

Anonymous requests return 401. Nonmembers, banned members and unavailable/cross-community resources receive generic 404 errors. Active members lacking a management permission or sufficient rank receive 403. Invalid fields return 400; changed payloads under an existing creation request ID and attempts to ban/leave as the owner return 409. Failures use ProblemDetails. Community names are trimmed, 2–80 characters, without control characters.

## Invitations and retries

The UI defaults to a 24-hour lifetime and ten uses; accepted ranges are 1–168 hours and 1–100 uses. Codes have 256 random bits encoded as 64 lowercase hex characters. Codes are submitted in request bodies, never URL paths/query strings or localStorage. Share them privately: possession allows a signed-in, eligible account to join.

PostgreSQL stores a SHA-256 lookup hash and an application-purpose-specific Data Protection ciphertext. Only an authorized invitation creation response returns the original code. The ciphertext supports retrying the same creation request after a lost response or host restart; ordinary metadata lists omit it and the raw code. Back up application keys with the database. Missing old keys can prevent code recovery on a creation retry, while acceptance of an already-shared code uses its stored hash.

Community creation is unique by owner/request ID; invitation creation is unique by community/request ID. Matching retries return the original resource; changed names/limits conflict. The first invitation expiry uses PostgreSQL microsecond precision so its value equals later stored responses. The UI retains a request ID while retrying the same submitted payload.

Invitation acceptance, creation/revocation, leave and bans use explicit Read Committed transactions and acquire the community row lock before reading mutable state. This serializes competing writers across API processes, rather than relying on in-process locks. Database constraints enforce one membership per community/user and valid invitation use counters. See [PostgreSQL locking](https://www.postgresql.org/docs/18/explicit-locking.html) and [EF transactions](https://learn.microsoft.com/en-us/ef/core/saving/transactions).

A valid repeated join by an already-active member does not consume another use, even when the use limit is full. Revoked/expired codes remain unusable, including repeated requests. Leaving and joining again consumes a new use. A ban overrides an otherwise-valid code and affects only that community. Lifting a ban changes membership to Left and requires a usable invitation to join again. The owner cannot be banned or kicked and cannot leave. Delegates cannot target themselves or equal/higher-ranked members. Leaving, kicking or banning clears assigned roles. Membership rows remain persisted; these operations do not delete accounts or communities.

Mutating community commands share a single-process fixed window of 60 requests per minute per authenticated account. Excess requests return 429 and `Retry-After: 60`. Invite expiry/revocation stops new acceptance; it does not remove existing members.

## UI and verification boundaries

Private Query cache keys include the account ID. Account changes remove other accounts' cached community data. A denied community query removes its detail/channel/management cache. A hidden channel clears its own cache and leaves other accessible community resources available. Community access/navigation checks run every 3 seconds while the page is active, other reads every 15 seconds and on focus; the server denies subsequent unauthorized requests immediately, but previously delivered information cannot be recalled. Text-channel subscriptions also reconcile current access and trigger HTTP recovery; see [messaging](messaging.md) and [text access](text-access.md).

The UI includes anonymous entry, empty lists, loading, connection failure/retry, retry-safe creation after a lost response, membership management and desktop/mobile layouts. PostgreSQL tests exercise cross-community identifiers, owner/member/nonmember boundaries, concurrent single-use consumption across hosts, waiting joins behind committed revocation/bans, creation retries and restart persistence. Tests refresh PostgreSQL monitoring snapshots when observing locks; see [statistics snapshots](https://www.postgresql.org/docs/18/monitoring-stats.html).

Run the normal build/check and migration commands from [development instructions](development.md). All fixtures are synthetic. Integration schemas and browser-created accounts/communities remain in the test/development database for inspection. Functional browser suites raise only their local test-host account registration quota to 120/minute; normal account limits and PostgreSQL rate-limit checks are unchanged. No load/latency or production deployment claim is made. List pagination, production retention/quotas and audit pagination remain later work.
