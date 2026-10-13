# Gatherings

Active community members can organize a gathering from the community's **Gatherings** link. Choose a future date/time, an explicit time zone and 1–50 current invitees. Title, description, game and a subsequently uploaded cover are optional. An invitation does not change access to existing text or voice channels.

Each invited user has one response: Pending, Accepted, Declined or NeedsClarification. Clarification requires a comment. An organizer's reply or an ordinary discussion comment preserves responses. Only the invited account may respond for itself. The organizer and community members with ManageRoles can manage the gathering; organizer, active invitees and these moderators can view it. These rules apply to HTTP, images and live routing. Unavailable private resources return 404.

Leaving, kicking or banning retires an invitation. Rejoining the community does not restore it; the organizer must explicitly invite that account again. Retired participants disappear from the current participant list. Historical revisions retain decisions for context and remain restricted to current authorized viewers. An organizer requires active membership to access their own gathering.

## Plans and time

The server stores the original local time and explicit zone, together with a UTC instant. The browser shows both organizer time and viewer-local time. Nonexistent or ambiguous daylight-saving times are rejected; choose another time. Merely changing the displayed zone while preserving the instant does not ask users to confirm again. Time-zone rules use the host .NET/OS time-zone data; operators should keep it updated.

Changes to the start instant or game archive the old plan and responses, advance the plan revision and reset responses to Pending. Text and cover edits preserve decisions. Added invitees start Pending; removed invitees lose access. The UI requires review of a changed plan before another response. Stale revision requests return 409. Separate string-valued versions protect edits, covers and lifecycle changes against concurrent mutations.

Scheduled gatherings can be cancelled, or explicitly completed after their start. Cancellation and completion disable new edits, responses and discussion. Completion does not assert attendance. No recurring events, calendar synchronization, temporary channels, automatic matching, email/push or scheduled reminders are implemented.

## Persistence and delivery

The Gatherings module is part of the existing ASP.NET Core monolith. PostgreSQL stores gatherings, invitations, comments, archived revisions, command receipts, private image metadata, notices and a durable delivery queue. Mutation state, notices, audit and queued hints commit together under the community writer lock. Payload-bound request IDs acknowledge retries without replaying an old decision over later changes. Every replay rechecks current authorization.

`/api/v1/communities/{communityId}/gatherings` exposes creation/listing, candidates, detail/edit, own response, discussion, revisions, lifecycle, covers and personal notices. Lists are paged: 20 gatherings, 100 candidate members or notifications; detail includes up to 200 discussion comments. Limits are engineering safeguards, not measured capacity guarantees: 100 scheduled gatherings per community, 100 revisions per gathering, 50 invitees. Notice read marking is personal and idempotent.

The `/hubs/gatherings` SignalR hub requires a current authenticated session, active membership and same-origin browser connection. A subscription identifies one community. Delivery rechecks current session, membership and gathering visibility for each connection. Notifications contain only a community refresh hint, with no gathering ID, title, participant list or discussion. Recently removed invitees may receive this generic hint to clear their caches; their detail requests are denied. Revoked sessions/memberships terminate subscriptions. Failed publication retains the queue entry for retry. HTTP refetch on connection recovery and periodic polling recover current state and durable notices even if hints are lost. These are refresh hints, with no exactly-once or ordered transport claim.

The worker is enabled by default. `Gatherings__WorkerEnabled=false` disables it for controlled integration fixtures; HTTP persistence and recovery still work. The initial in-process routing registry supports one API process; scaling to multiple hosts requires a separate reviewed delivery design.

## Covers and verification

Covers use the existing private filesystem store and shared quota, outside the public web root. PNG/JPEG uploads are bounded to 2 MiB and 2048×2048; signature/header dimensions are checked, without full decoding or malware scanning. Stored bytes determine the response MIME type. Each download checks current authorization and the current cover pointer, and returns no-store/nosniff/sandbox headers. Replacement/removal retires the old image; the existing cleanup worker purges known retired files. Uncertain orphan files are retained under the existing attachment policy. See [private storage configuration](attachments.md).

English is the default; the Russian language switch also covers this workflow. Integration tests verify independent decisions, revision archives, duplicate/concurrent requests, authorization, membership revocation, private media, lifecycle/time-zone boundaries and failed delivery. Browser tests exercise live UI, lost acknowledgements, stale drafts, offline recovery, cover decoding, cancellation and post-ban removal at desktop/mobile sizes. Run the repository's `npm run check`, `npm run test:database` and `npm run test:e2e` using the prerequisites in [development instructions](development.md).
