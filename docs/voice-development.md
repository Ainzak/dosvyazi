# Local voice development

The voice foundation provides a pinned self-hosted SFU, a narrow backend adapter and a synthetic browser test fixture. Community voice endpoints and product controls are not available yet. The adapter deliberately exposes no unauthenticated grant endpoint. Application authorization must precede grant creation when it is integrated.

## Local services

After the usual locked installation and `npm run check`, run:

```powershell
npm run setup:voice
npm run dev:voice
npm run install:browser
npm run test:voice
```

`setup:voice` creates random credentials in ignored `.local/voice.json`, preserves existing credentials, and generates ignored `.local/livekit.yaml`. Never publish either file. Repeat setup after cloning or when the generated YAML is missing. The separate Compose project retains the database configuration and volume. `npm run stop:voice` stops only its LiveKit service.

The image is LiveKit server v1.13.9, pinned by digest. Signaling HTTP/WebSocket port 7880, ICE/TCP 7881 and UDP mux 7882 bind to loopback only. The advertised local ICE address is 127.0.0.1. This configuration supports browsers on the same machine; it is not suitable for LAN/public deployment, production TLS or multiple hosts. No Redis, external service or firewall change is needed. See the [official local server guide](https://docs.livekit.io/transport/self-hosting/local/) and [deployment guidance](https://docs.livekit.io/transport/self-hosting/deployment/).

## Adapter boundaries

`IVoiceGateway` isolates the community .NET SDK (`Livekit.Server.Sdk.Dotnet` 1.2.3). It creates grants for opaque generated identities and generation-specific rooms, with a 60-second initial expiration. Publication is limited to microphone audio; subscription is allowed, application data and administrative grants are denied. The room limit of 16 is a development configuration, not a measured capacity.

Control calls use the documented [RoomService HTTP API](https://docs.livekit.io/reference/other/roomservice-api/) with per-request authorization and a two-second cancellation deadline. The SDK's RoomService implementation sets `HttpClient.DefaultRequestHeaders.Authorization` on each call and lacks caller cancellation parameters; sharing that client between concurrent room operations would be unsafe. The adapter instead retains SDK JWT generation and uses separate HTTP requests. A future application registration should use a typed `IHttpClientFactory` client. No SFU options are required to start the existing text application.

Removing a participant or restricting speaking does not invalidate an already issued token on a self-hosted server. Token expiration governs initial admission, and the SFU can issue longer-lived refreshed grants. See [LiveKit's token and revocation reference](https://docs.livekit.io/frontends/reference/tokens-grants/). Never report an application permission change as completed media revocation solely because the database changed or a grant expired. Durable generation transitions and current application authorization are required in the subsequent integration.

The pinned server's [protocol verifier](https://github.com/livekit/protocol/blob/a935cd67c29a/auth/verifier.go) permits one minute of clock-skew tolerance. A 60-second JWT expiration therefore does not establish a strict 60-second admission cutoff. The fixture checks both the post-expiry tolerance window and denial beyond that window using real elapsed time.

## Fixture and checks

`test:voice` starts a test-only stdio .NET process and serves only an in-memory synthetic page and the pinned browser SDK on loopback 5274. Chromium uses an oscillator-generated audio track; the fixture never requests the physical microphone. It connects two clients to uniquely named synthetic rooms, checks decoded audio energy, removal/restriction replay, room-generation separation, fresh listen-only grants and real original-token expiration. Captured refreshed tokens stay in process memory. Reports with synthetic observations and timings go to `.local/artifacts/voice/`; tokens, credentials and raw signaling are not written there.

The harness uses an internal SDK token-refresh event for observation, isolated to test code and pinned version 2.22.3. Run the test after building, without rebuilding the .NET projects concurrently on Windows. Stop the ordinary development API before `npm run check` to release its assembly lock. The fixture cleans up only its own generated rooms. It does not register accounts, alter community membership or delete user data.

Pipeline checks cover grant bounds, concurrent request isolation, sanitized control failures, timeout and caller cancellation. Existing database/browser suites remain applicable to the text application. Synthetic oscillator tests do not verify physical microphones, audible playback, actual phones, other browser engines, network outages or deployed ICE/TURN behavior. Product device/mute/deafen/reconnect UI and durable authorization/revocation handling remain separate work.
