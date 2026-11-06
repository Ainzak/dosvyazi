# Voice admission and named channels

The browser obtains a narrow, short-lived grant from the authenticated voice API. With `Voice:AdmissionRequired=true`, public signaling goes through `/livekit/rtc` or `/livekit/rtc/v1` on the same origin. The API proxies signaling only; audio/video packets still travel directly between clients and self-hosted LiveKit.

## Deployment boundary

Both VPS and on-prem Caddy configurations forward the complete `/livekit/*` path to the API. The API strips the prefix only when constructing the fixed private upstream connection. It exposes no RoomService/admin proxy. The VPS SFU signaling listener must bind to loopback; the on-prem SFU has no published signaling port. No public DNS name, alternate port or reverse-proxy route may bypass admission. Operators and other processes with access to the private SFU network remain trusted.

The development helper enables admission and uses `ws://127.0.0.1:5173/livekit`, proxied by Vite to the API. Override `Voice__BrowserUrl` when using a different browser origin. The legacy security fixture explicitly uses `Voice__AdmissionRequired=false` and direct loopback signaling; this does not provide targeted token rejection.

Admission verifies HS256 signature, issuer and expiration without extending its deadline (not-before allows at most five seconds of SFU clock lead), then checks the opaque lease identity, active lease/expiry, current application session/security stamp, active membership, effective channel permissions, exact room generation and permitted publishing sources. Administrative/data/metadata grants are rejected. Browser requests require an explicit matching Origin; cookies alone do not authorize admission. Validation endpoints perform the same lease checks. Tokens and signaling payloads must not be logged. The Caddy runtime logger redacts the `access_token` query parameter, including upstream-error entries, without enabling access logging. Keep ASP.NET request/startup HTTP logging below Information for credential-bearing signaling URLs; the supplied app settings do so.

The pinned LiveKit v1.13.9 [RTC service](https://github.com/livekit/livekit/blob/v1.13.9/pkg/service/rtcservice.go) registers the session before upgrading HTTP to WebSocket. Admission holds the account/community writer locks through this upstream acknowledgment. A separate authorization subrequest released before the upstream join would leave a revocation race. Recheck that ordering before changing the pinned SFU version. WebSocket relays stay awaited, cancel both directions and limit messages to 1 MiB; they do not retain signaling content.

An admission attempt is durably recorded before contacting the SFU. The second transaction rechecks access before connecting. An incomplete attempt expires after ten seconds; ambiguous failure freezes the room for generation recovery. A revocation between preparation and admission also takes the strict fallback. Normal completed admissions clear the marker before releasing the writer lock. The handshake has an eight-second overall deadline, shortened to the token expiration if earlier; database locks remain bounded by that cancellation.

## Revocation and continuity

In protected rooms, revocation closes the application lease and schedules individual SFU removal. Old and SFU-refreshed tokens cannot re-enter. Unaffected peers keep their room and tracks. A manually disconnected member may deliberately request a new lease if still authorized; the old request/token stays invalid. The client distinguishes actual moderator closure from permission/session changes by authenticated lease state, rather than the SFU's generic removal reason.

A durable operation ID with no completion timestamp records a pending targeted revocation while the room stays open to other authorized participants. Successful removal/confirmed absence completes it. A routine failed participant-list health read keeps existing peers connected; a failed read/removal during a pending revocation escalates to the durable fallback.

Generation isolation remains a fallback for legacy rooms, unknown participants, abandoned/ambiguous admission and failed control. Migrating an existing unprotected room requires one such transition before it becomes protected. These recovery cases can reconnect peers. A failed control operation cannot prove the removed user has stopped receiving media; the API reports control unavailability and retries durable recovery. Already received media cannot be recalled. This is application admission control, not a claim that self-hosted LiveKit implements cryptographic token revocation. See [LiveKit token lifecycle](https://docs.livekit.io/frontends/reference/tokens-grants/).

## Channels and compatibility

Communities retain their default channel, identified by the community UUID. An additive migration preserves its physical binding, generation, leases and category/rules, and creates a default channel for communities that never used voice. New channels have separate opaque IDs and physical bindings/generations. One active lease per account and 16 active leases per channel remain safeguards, not capacity measurements.

The existing `/api/v1/communities/{id}/voice` endpoints address the default channel. `/voice/channels/{channelId}` provides the same state/join/heartbeat/leave/disconnect operations for a named channel. Every lease, retry and operation is channel-scoped. Private channels are omitted from community navigation and return 404 to unauthorized callers. The sidebar count denotes active application voice leases, which may briefly include an unfinished connection; the channel participant list intersects leases with actual SFU participants.

Manage access can add up to 50 named voice channels and assign categories and per-role rules. Explicit denies still win, publishing requires speaking, owners retain their override, and delegated managers cannot exceed their rank/permissions. Existing names/channels must be retained in this slice. The default channel's legacy `voiceCategoryId` remains canonical. Old policy clients cannot silently remove additional channels: they receive a reload/conflict response.

Configuration export is version 2, including voice channel names/categories/rules. Version 1 files still import one default voice channel. Restore replaces every resource ID, keeps rules attached to the mapped channel, and imports no members or live leases. Review private names/rules before sharing a configuration. Moving channels explicitly closes the old session before joining the selected channel muted; microphone/camera/screen publications do not resume automatically.

Schema downgrade would discard channels or admission recovery state and is rejected. Preserve a matching database/files/keys/configuration backup before upgrading. If migration succeeded but startup fails, use a forward fix or an operator-approved isolated restore; do not start the old binary against the changed schema.
