# Single-host on-prem delivery

The operator bundle contains prebuilt Linux/amd64 API and web images, PostgreSQL18 and LiveKit images, Compose configuration, operator tools and checksums. The target needs Docker Engine with Compose v2+, Bash, curl, OpenSSL and standard GNU/Linux tools (`tar`, `sha256sum`, `realpath`, `stat`, `ss`, `ip`, `flock`). Node.js and the .NET SDK are needed only on the release builder. This is a single-host installation; it does not install Docker, change a firewall/VPN/daemon or adopt an existing manual VPS deployment.

Use an administrator-controlled Linux host with at least1GiB RAM, sufficient disk for images, application data and retained backups, and a DNS name. The resource limits in Compose are safeguards, not a capacity guarantee. Preflight requires2GiB free disk; allow additional space as data/backups grow. Public TLS uses ACME and requires working DNS and public challenge ports. Private/LAN TLS can use `--tls internal`; clients must trust that instance's CA. The operator tools never install a CA in the operating system.

## Prepare a release

Maintainers run the repository checks, build the web app and create the ordinary prebuilt release with `npm run package:vps`. Then run:

```sh
node scripts/package-onprem.mjs --release /absolute/path/to/prebuilt-release
```

Output lives under ignored `.local/artifacts/onprem-releases/`. The builder pulls digest-pinned base images, builds API/static web images, assigns unique local tags and exports all four images in `images.tar`. The manifest records platform, source revision/dirty state, API hash, migration hash, base digests and expected image identities. Only operator files enter the final archive; configuration credentials, local research, runtime data and build tools are excluded. There is no registry upload.

Docker [image save](https://docs.docker.com/reference/cli/docker/image/save/) and [image load](https://docs.docker.com/reference/cli/docker/image/load/) carry images and tags. After loading, the operator script also compares each tag's actual image ID with the release manifest. Obtain the archive and its expected checksum through a trusted channel: checksums detect changed bytes, not the identity of a publisher.

## Set up and install

Extract a trusted archive to a new release directory and check its external checksum and the included file checksums. Keep releases immutable and retain previous ones. Paths currently must be absolute and contain no spaces. Run:

```sh
bash manage.sh setup /srv/dosvyazi-instance \
  --project dosvyazi --domain chat.example.test --address 192.0.2.10
bash manage.sh preflight /srv/dosvyazi-instance
bash manage.sh install /srv/dosvyazi-instance
bash manage.sh status /srv/dosvyazi-instance
```

Replace the example DNS/IP with the real hostname and the server's reachable IPv4 address. Setup generates credentials in a private700 state directory with600 configuration files. Repeating identical setup preserves them; a changed request is rejected. `install` is explicit, verifies images, starts the database, prepares private storage, applies migrations and starts the app, web proxy and media service. Repeating the same installation preserves data. A recorded incomplete installation may be resumed; failures leave its data intact.

The default published ports are80/TCP,443/TCP,7881/TCP and7882/UDP. Optional setup flags are `--http-port`, `--https-port`, `--rtc-tcp`, `--rtc-udp`, `--network-prefix` and `--tls acme|internal`. TCP ports must be distinct. The private Docker /24 prefix defaults to172.30.42; choose a different172.16–31.x prefix if it conflicts. [Compose project names](https://docs.docker.com/compose/how-tos/project-name/) isolate container/network/volume ownership; use a different project for each installation and restore.

Preflight checks tooling, architecture, configuration, basic disk/RAM, existing project containers/volumes, listening host ports and overlapping Docker/host subnets. It does not take over conflicting resources. PostgreSQL and the API have no published ports. Forwarded headers are trusted only from loopback and the exact configured web-proxy IP, with one proxy hop. Docker publishes the selected web/RTC ports; the administrator remains responsible for ingress policy.

The HTTPS readiness probe validates the configured hostname, certificate chain, proxy route and current database schema. For internal TLS it uses only this instance's CA file. Test voice/camera/screen from a separate device/network: local readiness cannot prove NAT/firewall reachability or microphone permission. LiveKit advertises the selected address and uses the selected TCP/UDP ports; TURN is not configured by this bundle. See [LiveKit self-hosting guidance](https://docs.livekit.io/transport/self-hosting/deployment/) for restricted networks.

## Back up and restore

Backups briefly stop the API and web proxy for a matching snapshot. Plan a maintenance window; calls/navigation may be interrupted. The database and SFU stay running. The tool restarts the stopped services on completion or error.

```sh
bash manage.sh backup /srv/dosvyazi-instance /srv/dosvyazi-backups
```

The private snapshot contains a PostgreSQL custom-format dump, files, ASP.NET data-protection keys, Caddy certificates/CA/configuration, generated credentials and release metadata/checksums. Treat it as sensitive account data; move it to protected storage outside the server as appropriate. Backups are not encrypted automatically and are never deleted automatically. The printed path identifies the completed snapshot.

Restore accepts only a new state directory/project and a matching schema/contract. It never drops or replaces a live database or volume:

```sh
bash manage.sh restore /srv/dosvyazi-recovered /srv/dosvyazi-backups/SNAPSHOT \
  --project dosvyazi-recovered --domain recovered.example.test --address 192.0.2.10 \
  --https-port 8443 --http-port 8081 --rtc-tcp 7883 --rtc-udp 7884 \
  --network-prefix 172.30.43 --tls internal
```

Only restore trusted snapshots. The tool verifies checksums and archive paths before extracting into fresh volumes. Data-protection keys, account password hashes, private files and the original TLS authority are retained. Domain/port/project overrides allow an isolated recovery drill without changing the source. Configure production DNS/TLS only after checking restored data and authorization.

## Upgrade and failure recovery

Run the currently installed release's tool with the new release directory:

```sh
bash /srv/releases/CURRENT/manage.sh upgrade /srv/dosvyazi-instance /srv/releases/NEXT
```

The tool requires a newer release and the supported `forums-v1` contract, verifies image identities, creates a coherent backup, applies migrations and waits for HTTPS readiness. It retains the previous release and all backups. If startup fails with an unchanged migration hash, it can return to the previous code without restoring data. If migration fails or the migration hash changed, the API stays stopped for a forward fix or an isolated restore; a destructive database rollback is never attempted. Contract changes require a separately designed upgrade path. Do not run old binaries over data whose discussion/access model they do not understand.

`bash manage.sh stop STATE` stops only the selected instance and retains containers, volumes, credentials and backups. Status/log diagnostics must not expose credentials or user message bodies. To inspect service logs, use that release's Compose/project/configuration with care; do not share raw configuration or backup contents.

Single-host Linux/amd64 is the supported initial target. Native Windows/Android packages, automatic HA, air-gapped operation, external email configuration, TURN provisioning and automated backup deletion are outside this package.
