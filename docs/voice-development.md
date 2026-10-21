# Local voice development

Community members can join a shared voice room, select devices, mute/deafen and keep voice connected while navigating text channels. The API checks current membership, role/category/voice permissions and the authenticated database session before issuing narrow grants. The voice provider lives above routes; changing accounts disconnects and clears its state. Join starts muted and physical microphone permission is requested only when enabling the microphone.

## Local services

After the usual locked installation and `npm run check`, run:

```powershell
npm run setup:voice
npm run dev:voice
npm run migrate:api
npm run dev:api
```

Start `npm run dev:web` in another terminal and open the local workspace. Create a community or join using an invitation, select Join voice, then Enable microphone. Use headphones when testing two browser sessions on one computer. Deafen remembers whether your microphone was enabled and restores that choice when listening resumes, provided speaking is still permitted. Media devices expands the microphone/speaker/camera selectors. Select a camera while it is off, then deliberately enable it. Output selection depends on browser support. Output volume controls received audio from 0–100%, is saved locally on this browser, applies to new tracks/reconnects, and remains separate from deafen and microphone gain. Explicit Join/Reconnect starts a fresh request after membership changes; an unexpected stale-request error stays visible until manual retry. Leave voice disconnects locally before requesting server closure; an interrupted closure remains visible with Retry leave.

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

`IVoiceGateway` isolates the community .NET SDK (`Livekit.Server.Sdk.Dotnet` 1.2.3). It creates grants for opaque generated identities and generation-specific rooms, with a 60-second initial expiration. SpeakVoice controls microphone publication. ShareScreen additionally permits screen_share/screen_share_audio, and UseCamera permits camera; both require speaking access. New communities grant all three to ordinary speaking members. The MediaSharing migration copies existing speaking allows/denies into the new bits, advances policy versions and retires existing active leases through the protected transition; subscription is allowed, application data and administrative grants are denied. The room limit of 16 is a development configuration, not a measured capacity.

Control calls use the documented [RoomService HTTP API](https://docs.livekit.io/reference/other/roomservice-api/) with per-request authorization and a two-second cancellation deadline. The SDK's RoomService implementation sets `HttpClient.DefaultRequestHeaders.Authorization` on each call and lacks caller cancellation parameters; sharing that client between concurrent room operations would be unsafe. The adapter instead retains SDK JWT generation and uses separate HTTP requests through an `IHttpClientFactory` client. Only a documented `not_found` response makes deleting an absent room successful.

Removing a participant or restricting speaking does not invalidate an already issued token on a self-hosted server. Token expiration governs initial admission, and the SFU can issue longer-lived refreshed grants. See [LiveKit's token and revocation reference](https://docs.livekit.io/frontends/reference/tokens-grants/). Never report an application permission change as completed media revocation solely because the database changed or a grant expired.

## Application contract and transitions

Authenticated, no-store endpoints live under `/api/v1/communities/{id}/voice`:

| Method/path | Behavior |
| --- | --- |
| GET | Current generation, Pending/Ready operation state, control availability and actual SFU participants intersected with active leases; optional leaseId reports moderator closure only for the caller's own account/session/community lease |
| POST `/join` | CSRF-protected `clientRequestId`; identical valid retries return the stored grant; expired/changed retries return 409 |
| POST `/heartbeat` | CSRF-protected `leaseId`; renews a valid current session for 90 seconds |
| POST `/disconnect` | ModerateVoice and hierarchy protected specific-lease closure; repeat-safe for that lease |
| POST `/leave` | CSRF-protected `leaseId`; closes only that lease and schedules individual SFU removal; stale closure cannot end a newer lease |

Grants serialize under account and community PostgreSQL writer locks. One active application lease per account and a 16-member room bound are enforced; these are application limits, not strict protection against SFU token replay. Grant requests are rate-limited. Nonmembers receive 404 and anonymous requests receive 401. Current ViewChannel and ConnectVoice are required to join/renew; SpeakVoice controls the signed grant. State exposes effective connect/speak/moderation permissions and denial reasons. Voice rules and an optional category are configured in Manage access; text access is independent.

Ban, kick, community leave, logout, moderator disconnect and active-lease Connect/View/Speak changes persist Pending and stop new grants in the same database transaction as revocation. A worker validates leases, current sessions/security stamps, membership and current connect/speak/screen/camera permissions. Changing any publishing permission rotates the generation before issuing a new listener/publisher grant. It confirms old-room deletion and new-room creation before advancing the generation, deactivating old leases and recording completion. Remaining members reauthorize and reconnect, which interrupts their audio. API restart retains Pending intent. Control failure leaves issuance frozen and reports `controlUnavailable`; ongoing media cannot be guaranteed to stop until control succeeds. UI polling disconnects cooperative clients when a transition is observed, which is not a security boundary.

Voluntary voice leave and heartbeat expiry close only their exact lease. They do not retire the room or interrupt other participants' microphones, camera or screen publications. Reconciliation removes a departed SFU identity individually only while its membership, account session and publishing permissions are still valid. A self-hosted server can accept an old/refreshed token again: the worker removes that closed identity on subsequent observations; this is not cryptographic token revocation. A deliberately rejoining user obtains a fresh application lease/identity. Revoked access/session, changed publishing permissions, moderator closures and unknown identities continue to require the durable generation transition. Control failures retain the closed lease and retry removal without invalidating authorized peers. See [LiveKit token lifecycle](https://docs.livekit.io/frontends/reference/tokens-grants/).

Retired generations remain in a durable inventory and are periodically deleted because old grants may recreate them. Authorized peers enter only the current generation. The guarantee is separation from the current conversation after completion; already-heard audio cannot be recalled. No latency cutoff or performance distribution is claimed. Browser heartbeat runs every 10 seconds; voice state polling every 2 seconds. Worker checks are due every 1 second, or 3 seconds after control failure, with at most 16 due communities per pass.

`POST /api/v1/voice/webhook` verifies the signed JWT and SHA-256 of the exact raw UTF-8 body using the pinned SDK. It has a 256 KiB bound, persists event IDs/body hashes and treats events only as reconciliation hints. An old exit cannot clear a new lease. This endpoint has a narrow CSRF exemption; authentication is the SFU signature, never a cookie or claimed event name. The local SFU config does not enable webhook delivery by default because the API uses a host loopback listener; polling covers missed events. To configure an SFU-reachable internal URL later, follow the [official webhook configuration](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/). Do not expose or forward the API control secrets.

The pinned server's [protocol verifier](https://github.com/livekit/protocol/blob/a935cd67c29a/auth/verifier.go) permits one minute of clock-skew tolerance. A 60-second JWT expiration therefore does not establish a strict 60-second admission cutoff. The fixture checks both the post-expiry tolerance window and denial beyond that window using real elapsed time.

## Fixture and checks

`test:voice` starts a test-only stdio .NET process and serves only an in-memory synthetic page and the pinned browser SDK on loopback 5274. Chromium uses an oscillator-generated audio track; the fixture never requests the physical microphone. It connects two clients to uniquely named synthetic rooms, checks decoded audio energy, removal/restriction replay, room-generation separation, fresh listen-only grants and real original-token expiration. Captured refreshed tokens stay in process memory. Reports with synthetic observations and timings go to `.local/artifacts/voice/`; tokens, credentials and raw signaling are not written there.

The harness uses an internal SDK token-refresh event for observation, isolated to test code and pinned version 2.22.3. Run the test after building, without rebuilding the .NET projects concurrently on Windows. Stop the ordinary development API before `npm run check` to release its assembly lock. The fixture cleans up only its own generated rooms. It does not register accounts, alter community membership or delete user data.

Pipeline checks cover grant bounds, concurrent request isolation, sanitized control failures, timeout, caller cancellation and missing-room handling. PostgreSQL tests cover membership/CSRF boundaries, idempotency, cross-host account serialization, copied-session logout, waiting grants behind bans, stale exits, signed webhooks and durable failed transitions. Product desktop/mobile browser cases check synthetic audio, navigation, mute/deafen, ban, retired-grant separation and loading/error recovery. Synthetic tests do not verify physical microphones, audible playback, actual phones, other browser engines or deployed ICE/TURN behavior.

## Testing from another location

The loopback development URL cannot be shared with another computer. Remote testing needs a reachable HTTPS application, WSS signaling and reachable media candidates; a web-only tunnel does not provide the ICE media path. Use the accepted self-hosted Linux/Compose/Caddy deployment with valid certificates and configured ICE/TURN networking, or separately plan a private network test with trusted HTTPS and correct advertised network addresses. See [LiveKit ports and firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/). This repository has not deployed that environment. Once available, each tester creates an account; the owner shares a bounded community invitation code. Neither tester needs SFU credentials.


## Voice indicators and playback

Participant names wrap independently of moderation buttons. Speaking indicators use received/published microphone audio levels when Web Audio is available, with SDK speaker events as fallback. A shared analysis context samples every 60ms and holds activity for 300ms above an RMS threshold of 0.01; this indicates audio activity, not speech recognition. Muted, departed and retired-room participants are cleared. The analysis graph never plays the local microphone, and is released when leaving/changing rooms/accounts. These settings are implementation choices rather than measured guarantees across devices.

Allow audio playback appears only when the browser reports blocked remote playback. It explains that it enables other participants, shows pending/failure feedback, and disappears after success. Browser autoplay rules can require a click; see [LiveKit room events](https://docs.livekit.io/reference/client-sdk-js/types/RoomEventCallbacks.html).

A moderator disconnect persists a flag on the exact closed lease. The normal client ends its local voice intent and waits for an explicit Join voice. Other authorized members still recover automatically after generation changes; interrupted admission retries the same request. Disconnect does not remove membership or ConnectVoice permission: a member may deliberately join again. Use the existing permission/ban workflows for persistent denial. Old-lease moderation retries cannot affect a newer lease; querying another account/session/community lease does not reveal its closure.


## Microphone noise suppression

Voice controls include a Noise suppression checkbox, enabled by default with a preference saved in this browser. It uses the existing SDK's built-in WebRTC processing, without an additional service or model. Changing it updates the current microphone's processing constraints, preserving device, echo-cancellation and gain settings. If a browser accepts the change without applying it, an active microphone is refreshed and its underlying track replaced through the SDK. The old voice capture must first be released because some browsers share its processing with parallel captures; this can briefly interrupt audio. A failed refresh leaves the microphone muted with an explicit retry instruction. Muted/deafened users defer that refresh until explicit microphone activation. New capture requests include the preference, and it is reapplied after device changes and explicit microphone activation.

The UI checks browser constraint support and reads the track's actual settings. Before capture it shows that the preference applies when the microphone is enabled; unsupported browsers have a disabled control and an explanation. A rejected or unconfirmed request has a separate retry notice while voice remains usable. Replacement tracks are initially disabled and guarded by the current room/operation/permission/mute state; late tracks are stopped. Pending processing changes cannot restore an ended voice session or prevent the user from muting/leaving. Noise suppression quality depends on the browser, device and source; synthetic checks do not establish real-world noise-removal effectiveness.

Output volume controls all received voice-room audio, including shared-screen audio, and retains its browser-local setting. There is no per-participant volume control. Recorded voice messages have independent native inline playback/volume controls after Load voice message, as described in [attachments](attachments.md#voice-messages).

API references for the installed livekit-client 2.22.3: [audio capture options](https://docs.livekit.io/reference/client-sdk-js/interfaces/AudioCaptureOptions.html), [LocalAudioTrack.applyConstraints](https://docs.livekit.io/reference/client-sdk-js/classes/LocalAudioTrack.html#applyConstraints), and [browser constraints and actual settings](https://developer.mozilla.org/en-US/docs/Web/API/Media_Capture_and_Streams_API/Constraints). The existing SDK already requests noise suppression by default; this control makes that preference explicit and adjustable.

## Screen and camera sharing

Enable camera and Share screen are explicit actions in a connected community voice room. Both stay off on initial join and after a disconnect, offline period, permission transition or SDK reconnect. Leaving or changing accounts stops physical tracks immediately. A late browser picker result is stopped instead of published if that voice session ended. User-provided camera tracks prevent automatic SDK camera reacquisition. Cancellation of the screen picker keeps the voice connection usable; denied camera access has a separate recoverable notice.

View shared video opens a bounded gallery with participant/source labels, muted local preview, remote video and Focus video / Show all videos. The viewer uses normal page flow when expanded so it cannot cover channel navigation. Hiding it detaches video elements and allows adaptive subscriptions to pause their video; voice continues. VP8 publishes a single layer (simulcast disabled), with adaptiveStream/dynacast enabled. Standard camera requests up to 640x360/15fps/450kbit/s and standard screen capture up to 1280x720/15fps/1.2Mbit/s. Independent quality settings below also provide economy profiles and a higher screen profile. These are requested capture/encoding bounds; actual source dimensions, browser negotiation and delivered rate vary. They are not capacity or comparative-efficiency measurements.

Include screen audio when available is opt-in and browser/source-dependent. Missing screen audio leaves the screen visible and shows a notice. Received screen audio shares the output volume and deafen controls; deafening also mutes outbound screen audio. Microphone mute is independent. Video elements never play a duplicate audio stream or local microphone. Speaking indicators analyze microphone audio only.

Synthetic browser checks use the installed Chromium camera fixture and a continuously drawn canvas in place of a human source picker, with the real encoder/SFU/subscriber/decoder. They exercise publication, simultaneous sources, video focus, permission transitions, stop/cancel/late picker cleanup, denied camera and offline recovery. Foreground visible tiles are used for decoding assertions because adaptive subscriptions intentionally pause hidden/background video. Physical devices, true browser source selection, other engines and remote networks still need manual verification.

Primary API references: [LiveKit screen sharing](https://docs.livekit.io/transport/media/screenshare/), [source grants](https://docs.livekit.io/frontends/reference/tokens-grants/), [user-gesture screen capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia). The implementation uses the installed livekit-client 2.22.3 API; no SDK/server upgrade is needed.

## Independent outgoing quality settings

Open Audio and sharing settings > Media quality. Reduce audio quality and Reduce camera quality are separate switches. Screen-sharing quality offers Economy, Standard, High and Ultra. Preferences are independent, saved in this browser/device, and do not synchronize through the account. Choosing a profile for an inactive source does not enable it or request capture permission. These controls change your outgoing media; they do not change another participant's settings or replace mute/source on-off controls.

| Source | Economy | Standard | High | Ultra |
| --- | --- | --- | --- | --- |
| Microphone | Opus speech preset, up to 24kbit/s | Up to 48kbit/s | — | — |
| Camera | Up to 320x180, 10fps, 150kbit/s | Up to 640x360, 15fps, 450kbit/s | — | — |
| Screen | Up to 854x480, 10fps, 450kbit/s | Up to 1280x720, 15fps, 1.2Mbit/s | Up to 1920x1080, 30fps, 4Mbit/s | Up to 2560x1440, 60fps, 12Mbit/s |

High and Ultra screen quality need more network and client encoding resources; source resolution/browser/network can limit actual delivered quality. Audio presets retain DTX/RED; microphone quality does not change the opt-in shared-screen audio profile. Noise suppression remains independent. Ultra uses the browser motion content hint; the other screen profiles prioritize detail. The 12Mbit/s Ultra ceiling is a bounded initial setting, not a measured optimal rate. A lower-resolution or lower-frame-rate source cannot gain real detail or frames from this profile. Synthetic 60fps capture settings and sender ceilings do not guarantee 60 decoded frames/s on physical devices or remote networks.

An active source can pause briefly while that source alone is unpublished and republished using the same capture. Other sources, participants and the voice lease are retained. Capture constraints use the public browser API; the client checks reported limits where available. A rejected constraint change attempts to restore the previous constraints and preference. A failed publication stops only the affected source and asks the user to enable it explicitly, rather than repeatedly reusing a failed capture. Leaving stops in-flight capture and discards late results. Existing server/SFU source permissions still apply to every publication.

Quality browser tests use separate color-video fixtures for camera and the substituted screen source, keeping real capture constraints/encoding/SFU/decoding. They cover all sixteen settings combinations and high-resolution receipt; synthetic resolution checks do not establish physical-screen readability or quality on a remote network.

## Selective receiving and connection counters

Open Audio and sharing settings > Receiving and connection. Incoming video offers cameras and screens, screens only, or no video. The policy is saved on this browser/device and applies to future publications and reconnects. Individual remote camera/screen checkboxes in the viewer apply for the current connection and survive the sender changing that source's quality. A policy that excludes a source disables its individual checkbox. These controls use explicit SFU subscriptions; hiding a tile alone is not the receiving policy. Microphone and shared-screen audio continue. Your own capture and other participants' publishing settings do not change.

Remote publication metadata remains visible when unsubscribed, so a stream can be enabled again without leaving voice. The existing viewer still controls attachment and adaptive visibility. Current VP8 publishing has one video layer: receiving choices select streams, not an independently transcoded lower resolution. Outgoing quality remains a separate sender control.

Connection and media traffic samples the public SDK track WebRTC reports every two seconds, deduplicates RTP rows and computes bitrate from counter deltas. Totals count reported RTP payload bytes since this connection; they exclude HTTP/signaling, transport overhead and other applications. New connections reset counters. Missing browser measurements show a dash; failed or stale reports show unavailable rather than a healthy zero. RTT and receive jitter use the maximum available reported value; receive loss is the interval lost/(received+lost) ratio, with negative/reset counters handled as new segments. Video dimensions and FPS are browser-reported; when FPS is absent but frame counters exist it is derived over the sample interval. These values do not measure whole-device CPU, RAM or disk use.

Save connection report downloads settings and aggregate counters locally. It includes no participant names, community/room/track IDs, tokens, addresses, raw ICE/SDP reports or message content, and is not uploaded. The controlled receiving browser test uses a real local SFU, separate synthetic sources and all/none/none/all windows. Its RTP and renderer task-time/JavaScript-heap evidence is a functional local comparison, not a capacity benchmark, a whole-device resource measurement or a competitor comparison.

## Local microphone check, playback levels and push-to-talk

Before joining a voice room, expand Check microphone before joining. Start explicitly to capture the selected microphone locally, inspect the relative signal meter, and optionally Listen locally with headphones. It does not join voice, record audio or upload it. Stop, navigation, account/component teardown and focus/visibility loss release tracks and the analysis context; late permission results are discarded. The device selected after enumeration is used for this call. Silence suggests checking the input and hardware mute; the application cannot identify a hardware switch from silence alone. The meter is a relative signal indicator, not a calibrated loudness measurement. Access/device/capture errors and an ended source have retry guidance.

Participant playback in voice settings provides individual 0–100% levels and Mute for me. The effective playback level is master output volume multiplied by the participant level. Local mute remains in effect through deafen/undeafen and replacement publications. Both microphone and shared-screen audio from that participant use the level. Controls apply only to this voice connection and reset on a new connection/participant departure; there is no persistent personal listening history or new user-identity API. They do not modify another user's permissions, publication or playback, and do not promise network savings from local audio mute.

Push to talk is an opt-in, device-saved microphone mode. The microphone icon does not toggle continuous audio in this mode. Use Hold to talk (pointer/touch or Space/Enter when focused) or select the physical V/B/right-Control shortcut. Shortcuts operate only in the focused application tab outside text fields; they are not system-wide/background hotkeys. Release, pointer cancellation, key-up, blur, hidden tab, deafen, lost permission or disconnect close transmission. A fresh hold is required after recovery; repeated key-down events do not restart it.

The first hold obtains the physical microphone and publishes a user-provided mono track behind a zero-gain Web Audio gate. Publication begins muted; the gate opens only after current-room/permission/hold checks. Release synchronously disables the output track and closes gain before awaiting SDK mute, so a delayed SDK operation cannot reopen raw microphone audio. Capturing remains active after release for fast subsequent holds; mode change/leave disposes the physical stream, graph and output. Microphone device/processing changes require returning to continuous mode; saved processing preferences apply to the next physical PTT capture. Audio encoding quality remains independent. Only public browser/LiveKit APIs are used, with the pinned SDK unchanged.

Synthetic browser coverage checks local capture/monitoring/cleanup, denied/ended/silent sources, local/master/mute/deafen interactions, touch/keyboard focus and late capture/publication races, and real-SFU tone reception/silence. These checks do not measure physical device noise suppression, speech quality, global hotkeys or a universal microphone-release latency across remote networks.

## Microphone capture failure and retry

Capture failures distinguish browser/system permission denial, missing input, failed device capture and unsupported constraints, with English/Russian recovery instructions. Camera access does not establish microphone permission. A successful SDK call must still return a live microphone track before the UI shows it enabled. Failed microphone publications are stopped and unpublished independently of camera/screen; a later explicit enable reacquires capture rather than reusing an ended, unmuted publication. A failed device switch whose microphone track ended returns the UI to muted for explicit retry. The client does not silently bypass denial or switch to a different microphone. Browser error categories are described in [getUserMedia documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#exceptions). Synthetic tests do not diagnose a particular physical device without its actual failure category/browser context.
