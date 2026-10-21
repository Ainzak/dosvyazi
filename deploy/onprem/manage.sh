#!/usr/bin/env bash
set -euo pipefail
umask 077
release=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || fail "Required tool: $1"; }
usage() {
 cat <<'HELP'
Dosvyazi single-host Linux operator tools (Docker/Compose, no Node/.NET SDK required).
  bash manage.sh setup STATE --project NAME --domain HOST --address IPV4 [options]
    --https-port 443 --http-port 80 --rtc-tcp 7881 --rtc-udp 7882
    --network-prefix 172.30.42 --tls acme|internal
  bash manage.sh preflight STATE
  bash manage.sh install STATE
  bash manage.sh status STATE
  bash manage.sh backup STATE BACKUP_PARENT
  bash manage.sh restore NEW_STATE SNAPSHOT --project NEW_NAME --domain HOST --address IPV4 [options]
  bash manage.sh upgrade STATE NEW_RELEASE_DIRECTORY
  bash manage.sh stop STATE
Setup preserves an identical existing configuration. Install/restore never overwrite an instance.
TLS internal requires trusting the instance CA on clients. External DNS, TLS and RTC port reachability
must be checked from a separate network. No firewall/daemon/VPN settings are changed.
HELP
}
safe_path() { [[ "$1" =~ ^/[A-Za-z0-9_./-]+$ && "$1" != / ]] || fail 'Use an absolute path without spaces'; [[ ! -L "$1" ]] || fail 'Symlink state paths are unsupported'; }
absolute() { realpath -m -- "$1"; }
load_file() {
 local file=$1 key value
 [[ -f "$file" && ! -L "$file" ]] || fail "Missing regular configuration: $file"
 while IFS='=' read -r key value || [[ -n "$key" ]]; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  case "$key" in
   PROJECT|DOMAIN|ADVERTISE_IP|HTTPS_PORT|HTTP_PORT|RTC_TCP|RTC_UDP|NETWORK_PREFIX|TLS_ISSUER|POSTGRES_PASSWORD|LIVEKIT_API_KEY|LIVEKIT_API_SECRET|PACKAGE_ID|SCHEMA_CONTRACT|SCHEMA_SHA256|API_IMAGE|API_IMAGE_ID|WEB_IMAGE|WEB_IMAGE_ID|DATABASE_IMAGE|DATABASE_IMAGE_ID|LIVEKIT_IMAGE|LIVEKIT_IMAGE_ID) ;;
   *) fail "Unknown configuration key: $key";;
  esac
  [[ "$value" =~ ^[A-Za-z0-9_./:@-]+$ ]] || fail "Invalid configuration value for $key"
  printf -v "$key" '%s' "$value"; export "$key"
 done < "$file"
}
verify_release() {
 [[ "$(uname -s)" == Linux ]] || fail 'Target must run Linux'
 for tool in docker sha256sum tar curl realpath stat openssl ss flock ip; do need "$tool"; done
 (cd "$release" && sha256sum --check --status checksums.sha256) || fail 'Release checksum verification failed'
 load_file "$release/images.env"
 [[ "$PACKAGE_ID" =~ ^[0-9]{8}T[0-9]{9}Z$ && "$SCHEMA_CONTRACT" == forums-v1 && "$SCHEMA_SHA256" =~ ^[a-f0-9]{64}$ ]] || fail 'Unsupported release format/contract'
 docker info --format '{{.OSType}}/{{.Architecture}}' | grep -Eq '^linux/(x86_64|amd64)$' || fail 'Supported Docker target: linux/amd64'
 docker compose version --short | grep -Eq '^v?[2-9][0-9]*\.' || fail 'Docker Compose v2 or newer is required'
}
validate_config() {
 [[ "$PROJECT" =~ ^[a-z][a-z0-9-]{2,35}$ ]] || fail 'Project: 3–36 lowercase letters/digits/hyphens'
 [[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && "$DOMAIN" == *.* && "$DOMAIN" != *..* ]] || fail 'Use a DNS hostname without scheme/path/port'
 local part; IFS=. read -ra octets <<< "$ADVERTISE_IP"; [[ ${#octets[@]} == 4 ]] || fail 'Use an advertised IPv4 address'
 for part in "${octets[@]}"; do [[ "$part" =~ ^(0|[1-9][0-9]{0,2})$ && "$part" -le 255 ]] || fail 'Invalid advertised IPv4'; done
 [[ "$NETWORK_PREFIX" =~ ^172\.(1[6-9]|2[0-9]|3[01])\.([0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])$ ]] || fail 'Use a private 172.16–31.x /24 network prefix'
 [[ "$TLS_ISSUER" == acme || "$TLS_ISSUER" == internal ]] || fail 'TLS issuer: acme or internal'
 local p; for p in "$HTTPS_PORT" "$HTTP_PORT" "$RTC_TCP" "$RTC_UDP"; do [[ "$p" =~ ^[1-9][0-9]{0,4}$ && "$p" -le 65535 ]] || fail 'Port outside1–65535'; done
 [[ "$HTTPS_PORT" != "$HTTP_PORT" && "$HTTPS_PORT" != "$RTC_TCP" && "$HTTP_PORT" != "$RTC_TCP" ]] || fail 'TCP ports must be distinct'
 for part in "$POSTGRES_PASSWORD" "$LIVEKIT_API_KEY" "$LIVEKIT_API_SECRET"; do [[ "$part" =~ ^[A-Za-z0-9_-]{24,128}$ ]] || fail 'Invalid generated credential'; done
}
write_config() {
 local key
 for key in PROJECT DOMAIN ADVERTISE_IP HTTPS_PORT HTTP_PORT RTC_TCP RTC_UDP NETWORK_PREFIX TLS_ISSUER POSTGRES_PASSWORD LIVEKIT_API_KEY LIVEKIT_API_SECRET; do printf '%s=%s\n' "$key" "${!key}"; done > "$state/config.env"
 chmod 600 "$state/config.env"
 cat > "$state/livekit.yaml" <<CONFIG
port: 7880
bind_addresses: ["0.0.0.0"]
log_level: warn
rtc:
  tcp_port: $RTC_TCP
  udp_port: $RTC_UDP
  use_external_ip: false
  node_ip: $ADVERTISE_IP
keys:
  $LIVEKIT_API_KEY: $LIVEKIT_API_SECRET
CONFIG
 chmod 600 "$state/livekit.yaml"
}
setup() {
 state=$(absolute "$1"); shift; safe_path "$state"
 PROJECT=dosvyazi; DOMAIN=; ADVERTISE_IP=; HTTPS_PORT=443; HTTP_PORT=80; RTC_TCP=7881; RTC_UDP=7882; NETWORK_PREFIX=172.30.42; TLS_ISSUER=acme
 while [[ $# -gt 0 ]]; do [[ $# -ge 2 ]] || fail 'Missing option value'; case "$1" in
  --project) PROJECT=$2;; --domain) DOMAIN=$2;; --address) ADVERTISE_IP=$2;; --https-port) HTTPS_PORT=$2;; --http-port) HTTP_PORT=$2;; --rtc-tcp) RTC_TCP=$2;; --rtc-udp) RTC_UDP=$2;; --network-prefix) NETWORK_PREFIX=$2;; --tls) TLS_ISSUER=$2;; *) fail "Unknown option: $1";; esac; shift 2; done
 if [[ -e "$state/config.env" ]]; then
  local requested="$PROJECT|$DOMAIN|$ADVERTISE_IP|$HTTPS_PORT|$HTTP_PORT|$RTC_TCP|$RTC_UDP|$NETWORK_PREFIX|$TLS_ISSUER"
  load_file "$state/config.env"; validate_config
  [[ "$requested" == "$PROJECT|$DOMAIN|$ADVERTISE_IP|$HTTPS_PORT|$HTTP_PORT|$RTC_TCP|$RTC_UDP|$NETWORK_PREFIX|$TLS_ISSUER" ]] || fail 'Existing setup differs; credentials/configuration were preserved'
  printf 'Existing identical setup preserved.\n'; return
 fi
 [[ ! -e "$state" ]] || fail 'State directory already exists; use a new path'
 POSTGRES_PASSWORD=$(openssl rand -hex 24); LIVEKIT_API_KEY=$(openssl rand -hex 16); LIVEKIT_API_SECRET=$(openssl rand -hex 32); validate_config
 mkdir -p -- "$(dirname "$state")"; mkdir -m700 -- "$state"; exec 9>"$state/operator.lock"; flock -n 9 || fail 'Another setup is running'; write_config; printf '%s\n' "$release" > "$state/release.path"; printf 'Setup created; no services started. Run preflight, then install.\n'
}
load_state() {
 state=$(absolute "$1"); safe_path "$state"; load_file "$state/config.env"; validate_config
 [[ "$(stat -c '%a' "$state/config.env")" == 600 && "$(stat -c '%a' "$state")" == 700 ]] || fail 'State must be700 and config.env600; configuration contains credentials'
 export STATE_ROOT="$state"
}
dc() { docker compose -p "$PROJECT" --env-file "$release/images.env" --env-file "$state/config.env" -f "$release/compose.yml" "$@"; }
check_images() {
 local role var expected
 for role in API WEB DATABASE LIVEKIT; do var=${role}_IMAGE; expected=${role}_IMAGE_ID; [[ "$(docker image inspect --format '{{.Id}}' "${!var}")" == "${!expected}" ]] || fail "Image identity mismatch: $role"; done
}
check_ports() {
 local p published; published=$(docker ps --format '{{.Ports}}')
 for p in "$HTTP_PORT" "$HTTPS_PORT" "$RTC_TCP"; do
  [[ -z "$(ss -H -ltn "sport = :$p")" ]] || fail "TCP port$p already in use"
  if grep -Eq ":$p->[0-9]+/tcp" <<< "$published"; then fail "TCP port$p is published by another container"; fi
 done
 [[ -z "$(ss -H -lun "sport = :$RTC_UDP")" ]] || fail "UDP port$RTC_UDP already in use"
 if grep -Eq ":$RTC_UDP->[0-9]+/udp" <<< "$published"; then fail "UDP port$RTC_UDP is published by another container"; fi
}
preflight() {
 dc config --quiet
 [[ $(df -Pk "$state" | awk 'NR==2 {print $4}') -ge 2097152 ]] || fail 'At least2GiB free disk is required'
 [[ $(awk '/MemTotal:/ {print $2}' /proc/meminfo) -ge 900000 ]] || fail 'At least900MiB physical memory is required'
 if [[ ! -f "$state/installed" && ! -f "$state/installing" ]]; then
  [[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")" ]] || fail 'Project name belongs to existing containers'
  [[ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")" ]] || fail 'Project name belongs to existing volumes'
  check_ports
  # Detect overlap with other Docker networks, including larger prefixes, using integer masks.
  local subnet address bits a b c d network wanted mask
  IFS=. read -r a b c <<< "$NETWORK_PREFIX"; wanted=$(( (a<<24) | (b<<16) | (c<<8) ))
  while read -r subnet; do
   [[ "$subnet" == *.*/* ]] || continue; address=${subnet%/*}; bits=${subnet#*/}; IFS=. read -r a b c d <<< "$address"; network=$(( (a<<24) | (b<<16) | (c<<8) | d )); [[ "$bits" -le 24 ]] || bits=24; mask=$(( (0xffffffff << (32-bits)) & 0xffffffff ))
   [[ $((wanted & mask)) != $((network & mask)) ]] || fail "Docker subnet conflict: $subnet"
  done < <(docker network ls -q | xargs -r docker network inspect --format '{{range .IPAM.Config}}{{println .Subnet}}{{end}}'; ip -4 route show | awk '$1 ~ /^[0-9]+\./ && $1 ~ /\// {print $1}')
 fi
 printf 'Preflight passed. Verify DNS/TLS and TCP%s/UDP%s from another network; no firewall changes made.\n' "$RTC_TCP" "$RTC_UDP"
}
initialize_data() {
 dc run -T --rm --no-deps tools -c 'mkdir -p /managed/files /managed/keys /managed/livekit; chown 1654:1654 /managed/files /managed/keys; chmod 700 /managed/files /managed/keys /managed/livekit; umask 077; cat > /managed/livekit/livekit.yaml; chown 0:0 /managed/livekit/livekit.yaml; chmod 600 /managed/livekit/livekit.yaml' < "$state/livekit.yaml" >/dev/null
}
wait_database() { local n; for n in $(seq 1 40); do if dc exec -T database pg_isready -U dosvyazi -d dosvyazi >/dev/null 2>&1; then return; fi; sleep 1; done; fail 'Database not ready'; }
ready() {
 local n; local cert=()
 for n in $(seq 1 40); do
  if [[ "$TLS_ISSUER" == internal ]]; then
   if ! dc exec -T web cat /data/caddy/pki/authorities/local/root.crt > "$state/ca.crt" 2>/dev/null; then sleep 1; continue; fi
   cert=(--cacert "$state/ca.crt")
  fi
  if curl -fsS --max-time 3 "${cert[@]}" --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" "https://$DOMAIN:$HTTPS_PORT/health/ready" 2>/dev/null | grep -q '"status":"healthy"'; then
   if dc exec -T web wget -qO- http://livekit:7880/ 2>/dev/null | grep -q '^OK'; then return; fi
  fi
  sleep 1
 done
 fail 'Application readiness failed; preserve state and inspect status'
}
install() {
 if [[ -f "$state/installed" ]]; then [[ "$(cat "$state/installed")" == "$PACKAGE_ID" ]] || fail 'Instance has another release; use upgrade'; ready; printf 'Existing installation preserved.\n'; return; fi
 preflight; docker image load -i "$release/images.tar" >/dev/null; check_images
 printf '%s\n' "$PACKAGE_ID" > "$state/installing"
 dc up -d database; wait_database; initialize_data
 dc run -T --rm --no-deps api --migrate
 dc up -d api livekit web; ready
 mv "$state/installing" "$state/installed"; printf '%s\n' "$release" > "$state/release.path"; cp "$release/images.env" "$state/installed-release.env"
 printf 'Installed https://%s:%s; verify media connectivity from another network.\n' "$DOMAIN" "$HTTPS_PORT"
}
snapshot() {
 local parent=$1; parent=$(absolute "$parent"); safe_path "$parent"; [[ -f "$state/installed" ]] || fail 'No installed instance'
 mkdir -m700 -p "$parent"; backup="$parent/snapshot-$(date -u +%Y%m%dT%H%M%S)-$RANDOM"; mkdir -m700 "$backup"
 dc stop api web >/dev/null; trap 'dc start api web >/dev/null || true' EXIT
 dc exec -T database pg_dump -U dosvyazi -d dosvyazi -Fc > "$backup/database.dump"
 dc exec -T database pg_restore --list < "$backup/database.dump" >/dev/null
 dc run -T --rm --no-deps tools -c 'tar -czf - -C /managed files keys caddy caddy-config' > "$backup/private-files-keys.tar.gz"
 cp "$state/config.env" "$state/installed-release.env" "$backup/"; cp "$release/release.json" "$backup/release.json"
 (cd "$backup" && sha256sum database.dump private-files-keys.tar.gz config.env installed-release.env release.json > checksums.sha256)
 chmod 600 "$backup/"*; dc start api web >/dev/null; trap - EXIT
 printf 'Backup created: %s\n' "$backup"
}
restore() {
 local destination=$1 snapshot=$2; shift 2; snapshot=$(absolute "$snapshot"); safe_path "$snapshot"
 (cd "$snapshot" && sha256sum --check --status checksums.sha256) || fail 'Snapshot checksum mismatch'
 local old_password old_key old_secret old_contract old_schema
 load_file "$snapshot/installed-release.env"; old_contract=$SCHEMA_CONTRACT; old_schema=$SCHEMA_SHA256
 load_file "$snapshot/config.env"; old_password=$POSTGRES_PASSWORD; old_key=$LIVEKIT_API_KEY; old_secret=$LIVEKIT_API_SECRET
 load_file "$release/images.env"; [[ "$old_contract" == "$SCHEMA_CONTRACT" && "$old_schema" == "$SCHEMA_SHA256" ]] || fail 'Restore requires matching schema and contract'
 [[ ! -e "$(absolute "$destination")" ]] || fail 'Restore target must be new; live state is never overwritten'
 setup "$destination" "$@"; POSTGRES_PASSWORD=$old_password; LIVEKIT_API_KEY=$old_key; LIVEKIT_API_SECRET=$old_secret; write_config; load_state "$destination"; preflight
 docker image load -i "$release/images.tar" >/dev/null; check_images; dc up -d database; wait_database
 dc exec -T database pg_restore -U dosvyazi -d dosvyazi --exit-on-error < "$snapshot/database.dump"
 # A self-created snapshot is still checked for traversal before extraction into fresh volumes.
 tar -tzf "$snapshot/private-files-keys.tar.gz" | while read -r entry; do [[ "$entry" != /* && "$entry" != *..* && ( "$entry" == files* || "$entry" == keys* || "$entry" == caddy* ) ]] || fail 'Unsafe snapshot path'; done
 dc run -T --rm --no-deps tools -c 'tar -xzf - -C /managed' < "$snapshot/private-files-keys.tar.gz"
 initialize_data
 dc up -d api livekit web; ready; printf '%s\n' "$PACKAGE_ID" > "$state/installed"; printf '%s\n' "$release" > "$state/release.path"; cp "$release/images.env" "$state/installed-release.env"
 printf 'Restored into new instance; source snapshot and instance retained.\n'
}
upgrade() {
 local next; next=$(absolute "$1"); safe_path "$next"; [[ -f "$state/installed" ]] || fail 'No installed instance'; [[ "$(cat "$state/release.path")" == "$release" ]] || fail 'Run the current installed release manage.sh'
 local old_id=$PACKAGE_ID old_contract=$SCHEMA_CONTRACT old_schema=$SCHEMA_SHA256 previous=$release
 release=$next; verify_release; [[ "$SCHEMA_CONTRACT" == "$old_contract" ]] || fail 'Unsupported upgrade contract'; [[ "$PACKAGE_ID" > "$old_id" ]] || fail 'Upgrade requires a newer release'; dc config --quiet
 docker image load -i "$release/images.tar" >/dev/null; check_images
 release=$previous; load_file "$release/images.env"; snapshot "$state/backups"; release=$next; load_file "$release/images.env"
 dc stop api >/dev/null
 if ! dc run -T --rm --no-deps api --migrate; then fail 'Migration failed; API kept stopped, backup retained; forward fix or isolated restore required'; fi
 if ! dc up -d api livekit web || ! (ready); then
  if [[ "$old_schema" == "$SCHEMA_SHA256" ]]; then release=$previous; load_file "$release/images.env"; dc up -d api livekit web; fail 'New release unhealthy; code rollback completed without restoring data'; fi
  dc stop api >/dev/null; fail 'Schema changed; API stopped; backup retained; forward fix or isolated restore required'
 fi
 printf '%s\n' "$PACKAGE_ID" > "$state/installed"; printf '%s\n' "$release" > "$state/release.path"; cp "$release/images.env" "$state/installed-release.env"; printf 'Upgrade completed; previous release and backup retained.\n'
}
[[ $# -gt 0 ]] || { usage; exit 0; }; action=$1; shift
[[ "$action" != --help ]] || { usage; exit 0; }
verify_release
case "$action" in
 setup) [[ $# -ge 1 ]] || fail 'Missing STATE'; setup "$@";;
 restore) [[ $# -ge 2 ]] || fail 'Missing NEW_STATE/SNAPSHOT'; restore "$@";;
 preflight|install|status|backup|upgrade|stop)
  [[ $# -ge 1 ]] || fail 'Missing STATE'; load_state "$1"; shift; [[ "$(cat "$state/release.path")" == "$release" ]] || fail 'Run the installed release manage.sh'; exec 9>"$state/operator.lock"; flock -n 9 || fail 'Another operator action is running'
  case "$action" in preflight) preflight;; install) install;; status) dc ps; ready;; backup) [[ $# == 1 ]] || fail 'Missing BACKUP_PARENT'; snapshot "$1";; upgrade) [[ $# == 1 ]] || fail 'Missing NEW_RELEASE_DIRECTORY'; upgrade "$1";; stop) dc stop;; esac;;
 *) usage; fail 'Unknown action';;
esac
