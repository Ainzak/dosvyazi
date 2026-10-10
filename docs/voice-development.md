# Local voice development

Community members can join a shared voice room, select devices, mute/deafen and keep voice connected while navigating text channels. The API checks current membership and the authenticated database session before issuing narrow grants. The voice provider lives above routes; changing accounts disconnects and clears its state. Join starts muted and physical microphone permission is requested only when enabling the microphone.

## Local services

After the usual locked installation and `npm run check`, run:

```powershell
npm run setup:voice
npm run dev:voice
npm run migrate:api
npm run dev:api
```

Start `npm run dev:web` in another terminal and open the local workspace. Create a community or join using an invitation, select Join voice, then Enable microphone. Use headphones when testing two browser sessions on one computer. Audio devices expands the microphone/speaker selectors. Output selection depends on browser support. Leave voice disconnects locally before requesting server closure; an interrupted closure remains visible with Retry leave.

For synthetic automation:

```powershell
npm run install:browser
npm run test:voice
npm run test:e2e
```

`setup:voice` creates random credentials in ignored `.local/voice.json`, preserves existing credentials, and generates ignored `.local/livekit.yaml`. Never publish either file. Repeat setup after cloning or when the generated YAML is missing. The separate Compose project retains the database configuration and volume. `npm run stop:voice` stops only its LiveKit service.

The development API automatically loads these local credentials when present. `Voice__Enabled=false` disables voice. Explicit `Voice__ApiKey`, `Voice__ApiSecret`, `Voice__ControlUrl` and `Voice__BrowserUrl` environment values override local defaults. The API validates enabled configuration at startup. Keep the control URL private and use persistent Data Protection keys: retried grants are encrypted in PostgreSQL. The existing text application still starts without voice credentials.

The image is LiveKit server v1.13.9, pinned by digest. Signaling HTTP/WebSocket port 7880, ICE/TCP 7881 and UDP mux 7882 bind to loopback only. The advertised local ICE address is 127.0.0.1. This configuration supports browsers on the same machine; it is not suitable for LAN/public deployment, production TLS or multiple hosts. No Redis, external service or firewall change is needed. See the [official local server guide](https://docs.livekit.io/transport/self-hosting/local/) and [deployment guidance](https://docs.livekit.io/transport/self-hosting/deployment/).

## Adapter boundaries

`IVoiceGateway` isolates the community .NET SDK (`Livekit.Server.Sdk.Dotnet` 1.2.3). It creates grants for opaque generated identities and generation-specific rooms, with a 60-second initial expiration. Publication is limited to microphone audio; subscription is allowed, application data and administrative grants are denied. The room limit of 16 is a development configuration, not a measured capacity.

Control calls use the documented [RoomService HTTP API](https://docs.livekit.io/reference/other/roomservice-api/) with per-request authorization and a two-second cancellation deadline. The SDK's RoomService implementation sets `HttpClient.DefaultRequestHeaders.Authorization` on each call and lacks caller cancellation parameters; sharing that client between concurrent room operations would be unsafe. The adapter instead retains SDK JWT generation and uses separate HTTP requests through an `IHttpClientFactory` client. Only a documented `not_found` response makes deleting an absent room successful.

Removing a participant or restricting speaking does not invalidate an already issued token on a self-hosted server. Token expiration governs initial admission, and the SFU can issue longer-lived refreshed grants. See [LiveKit's token and revocation reference](https://docs.livekit.io/frontends/reference/tokens-grants/). Never report an application permission change as completed media revocation solely because the database changed or a grant expired.

## Application contract and transitions

Authenticated, no-store endpoints live under `/api/v1/communities/{id}/voice`:

| Method/path | Behavior |
| --- | --- |
| GET | Current generation, Pending/Ready operation state, control availability and actual SFU participants intersected with active leases |
| POST `/join` | CSRF-protected `clientRequestId`; identical valid retries return the stored grant; expired/changed retries return 409 |
| POST `/heartbeat` | CSRF-protected `leaseId`; renews a valid current session for 90 seconds |
| POST `/leave` | CSRF-protected `leaseId`; closes that lease and requests a durable transition; stale closure cannot end a newer lease |

Grants serialize under account and community PostgreSQL writer locks. One active application lease per account and a 16-member room bound are enforced; these are application limits, not strict protection against SFU token replay. Grant requests are rate-limited. Nonmembers receive 404 and anonymous requests receive 401. Role/channel ConnectVoice/SpeakVoice policy is a later milestone; current voice access follows active community membership.

Ban, community leave, voice leave and logout persist Pending and stop new grants in the same database transaction as revocation. A worker validates leases, current sessions/security stamps and membership. It confirms old-room deletion and new-room creation before advancing the generation, deactivating old leases and recording completion. Remaining members reauthorize and reconnect, which interrupts their audio. API restart retains Pending intent. Control failure leaves issuance frozen and reports `controlUnavailable`; ongoing media cannot be guaranteed to stop until control succeeds. UI polling disconnects cooperative clients when a transition is observed, which is not a security boundary.

Retired generations remain in a durable inventory and are periodically deleted because old grants may recreate them. Authorized peers enter only the current generation. The guarantee is separation from the current conversation after completion; already-heard audio cannot be recalled. No latency cutoff or performance distribution is claimed. Browser heartbeat runs every 10 seconds; voice state polling every 2 seconds. Worker checks are due every 1 second, or 3 seconds after control failure, with at most 16 due communities per pass.

`POST /api/v1/voice/webhook` verifies the signed JWT and SHA-256 of the exact raw UTF-8 body using the pinned SDK. It has a 256 KiB bound, persists event IDs/body hashes and treats events only as reconciliation hints. An old exit cannot clear a new lease. This endpoint has a narrow CSRF exemption; authentication is the SFU signature, never a cookie or claimed event name. The local SFU config does not enable webhook delivery by default because the API uses a host loopback listener; polling covers missed events. To configure an SFU-reachable internal URL later, follow the [official webhook configuration](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/). Do not expose or forward the API control secrets.

The pinned server's [protocol verifier](https://github.com/livekit/protocol/blob/a935cd67c29a/auth/verifier.go) permits one minute of clock-skew tolerance. A 60-second JWT expiration therefore does not establish a strict 60-second admission cutoff. The fixture checks both the post-expiry tolerance window and denial beyond that window using real elapsed time.

## Fixture and checks

`test:voice` starts a test-only stdio .NET process and serves only an in-memory synthetic page and the pinned browser SDK on loopback 5274. Chromium uses an oscillator-generated audio track; the fixture never requests the physical microphone. It connects two clients to uniquely named synthetic rooms, checks decoded audio energy, removal/restriction replay, room-generation separation, fresh listen-only grants and real original-token expiration. Captured refreshed tokens stay in process memory. Reports with synthetic observations and timings go to `.local/artifacts/voice/`; tokens, credentials and raw signaling are not written there.

The harness uses an internal SDK token-refresh event for observation, isolated to test code and pinned version 2.22.3. Run the test after building, without rebuilding the .NET projects concurrently on Windows. Stop the ordinary development API before `npm run check` to release its assembly lock. The fixture cleans up only its own generated rooms. It does not register accounts, alter community membership or delete user data.

Pipeline checks cover grant bounds, concurrent request isolation, sanitized control failures, timeout, caller cancellation and missing-room handling. PostgreSQL tests cover membership/CSRF boundaries, idempotency, cross-host account serialization, copied-session logout, waiting grants behind bans, stale exits, signed webhooks and durable failed transitions. Product desktop/mobile browser cases check synthetic audio, navigation, mute/deafen, ban, retired-grant separation and loading/error recovery. Synthetic tests do not verify physical microphones, audible playback, actual phones, other browser engines or deployed ICE/TURN behavior.

## Testing from another location

The loopback development URL cannot be shared with another computer. Remote testing needs a reachable HTTPS application, WSS signaling and reachable media candidates; a web-only tunnel does not provide the ICE media path. Use the accepted self-hosted Linux/Compose/Caddy deployment with valid certificates and configured ICE/TURN networking, or separately plan a private network test with trusted HTTPS and correct advertised network addresses. See [LiveKit ports and firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/). This repository has not deployed that environment. Once available, each tester creates an account; the owner shares a bounded community invitation code. Neither tester needs SFU credentials.
