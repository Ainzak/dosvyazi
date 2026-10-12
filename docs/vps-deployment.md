# Single-host VPS test deployment

This Linux/Compose/Caddy configuration runs the current browser UI, ASP.NET Core API, PostgreSQL 18 and self-hosted LiveKit. It supports a small remote test; configured limits are not capacity measurements. Physical audio and each tester's network still need manual acceptance.

## Build and transfer

Use the repository's pinned local toolchain. Build on the development machine, rather than installing Node or the .NET SDK on a small VPS:

```powershell
npm ci
npm run restore:api
npm run check
npm run package:vps
```

The last command produces a new `.local/artifacts/vps-releases/release-<id>.tar.gz` and SHA256 file. The archive contains the framework-dependent API publish output, static browser files, Dockerfile and Compose/Caddy configuration. It excludes local databases, credentials, research and development configuration. Transfer it through verified SSH/SCP, check its SHA256 and extract under `/opt/dosvyazi/releases/release-<id>`. Keep previous releases.

## Host prerequisites and existing services

Use Docker Engine and the Compose plugin from [Docker's official Ubuntu repository](https://docs.docker.com/engine/install/ubuntu/). Back up relevant existing configuration and record installed versions, file changes and firewall rules before installation. Do not use a convenience script, upgrade unrelated packages, reboot or reset existing networking as part of deployment.

All four services use host networking. PostgreSQL binds `127.0.0.1:15432`, the API binds `127.0.0.1:5080`, and Caddy proxies to these local services. LiveKit's HTTP/WebSocket port 7880 must stay blocked externally. Host networking avoids Docker-published ports bypassing UFW; see [Docker firewall behavior](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

On a newly installed Docker host that already routes VPN traffic, this deployment uses the following `/etc/docker/daemon.json`. Merge deliberately with any existing daemon configuration; do not overwrite it:

```json
{
  "bridge": "none",
  "ip-forward": false,
  "ip-forward-no-drop": true,
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

The disabled default bridge makes this host-network configuration explicit. Existing forwarding settings and routes must be checked before/after installation. This configuration does not suit other applications that require a default Docker bridge without additional planning.

The Caddyfile uses TLS-ALPN certificate validation on 443, disables HTTP validation and automatic HTTP redirects, and serves only HTTP/1.1 and HTTP/2. An existing Nginx service can keep port 80. Both A and AAAA records, if present, must identify this host; inbound 443 must work for certificate validation. See [Caddy TLS settings](https://caddyserver.com/docs/caddyfile/directives/tls).

Add only the required host/provider firewall rules, preserving SSH, VPN and existing rules:

- TCP 443: HTTPS, API/SignalR and LiveKit WSS.
- TCP 7881: LiveKit ICE/TCP fallback.
- UDP 50000–60000: direct LiveKit media.

Do not expose 5080, 15432, 5432, 7880, the Caddy admin endpoint or Docker API. This initial configuration has no TURN/TLS relay; restrictive networks may require a separate verified TURN setup. See [LiveKit ports](https://docs.livekit.io/transport/self-hosting/ports-firewall/). The `wss://<domain>/livekit` route preserves SDK subpaths by stripping only `/livekit` before forwarding.

## Private configuration and startup

Create `/opt/dosvyazi/config` and `/opt/dosvyazi/data` with restrictive access. Fill a root-readable-only `config/deployment.env` from `deploy/.env.vps.example`, generating independent random server credentials. Fill `config/livekit.yaml` from the LiveKit template with the same key/secret, actual public IPv4 and public interface name. Never print a rendered Compose configuration containing secrets.

Resolve/pin the official ASP.NET Core 10.0.11 runtime image digest before building the release API image. The Caddy template pins the verified 2.11.7 image digest; PostgreSQL 18.6 and LiveKit 1.13.9 retain the project's existing pins.

Create persistent `data/postgres`, `data/keys`, `data/files`, `data/caddy` and `data/caddy-config` directories. The PostgreSQL mount root must be traversable by its image's PostgreSQL UID/GID (999:999 for the pinned image); root-owned mode 700 prevents startup even if the nested PGDATA is correctly owned. Keys and private attachment files need ownership 1654:1654 and mode 700 for the API's non-root user. Keep the parent directories root-only.

From the extracted release directory, with `ASPNET_IMAGE` set to the verified runtime image digest:

```bash
docker build --network host --build-arg "ASPNET_IMAGE=$ASPNET_IMAGE" -t dosvyazi-api:<release-id> -f Dockerfile.api .
docker compose --env-file /opt/dosvyazi/config/deployment.env -f compose.yml config --quiet
docker compose --env-file /opt/dosvyazi/config/deployment.env -f compose.yml up -d --wait database livekit
docker compose --env-file /opt/dosvyazi/config/deployment.env -f compose.yml run -T --rm --no-deps api --migrate
docker compose --env-file /opt/dosvyazi/config/deployment.env -f compose.yml up -d api caddy
```

Set `API_IMAGE` in the private env file to the built tag. Schema migrations are explicit and idempotent; startup never automatically migrates. The API processes forwarded scheme/client IP only when `ReverseProxy:Enabled` is set and only from the single loopback proxy. It does not trust forwarded Host or arbitrary proxy networks. Persistent Data Protection keys keep cookie/voice-token protection across restarts. Local password-authenticated PostgreSQL uses GSS encryption disabled so the minimal runtime needs no Kerberos library.

Check trusted HTTPS `/health/ready`, secure account cookies, desktop/mobile UI, two-user messages and actual WSS/ICE audio. Check Nginx, VPN interfaces/routes, forwarding and external port reachability. Use `docker stats` and recorded observations; memory limits alone do not demonstrate capacity. Containers restart with Docker; a host reboot was not required for this setup.

## Stop and rollback

Stop only this Compose project to disable the test while preserving all data:

```bash
docker compose --env-file /opt/dosvyazi/config/deployment.env -f /opt/dosvyazi/current/compose.yml stop
```

Keep database storage, key files, certificates and backup archives. Never use `down -v`, remove volumes, flush firewall rules or roll migrations backwards to undo a service installation. Remove only firewall rules specifically added for this deployment. Restore individual original configuration files after review; a full UFW restore could discard newer bans or user changes. If Docker must be removed, first stop this project and use the exact logged new package list without `autoremove` or deleting its data.

Before later application/schema updates, back up PostgreSQL with `pg_dump`, back up the private attachment directory, and separately protect the private configuration and Data Protection keys. Restoring an older API against changed schema requires a compatibility review. Revoke temporary deployment SSH access once verification is finished.
