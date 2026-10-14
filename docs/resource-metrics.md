# Private resource metrics

The optional Linux collector in `deploy/metrics/` uses Python 3's standard library, Docker metadata and cgroup v2. A systemd timer records one sample per minute without another always-running server, dashboard, dependency or public endpoint. It reads aggregate counters only: no message contents, account names, IP addresses, requests, credentials or packet capture.

## Installation

Requires Linux with cgroup v2, Docker, Python 3 and systemd. The current Compose project names its containers `dosvyazi-vps-{api,database,livekit,caddy}-1`; adjust the collector if deploying a differently named project. Install as root after reviewing existing paths/units; preserve any previous monitoring installation.

```bash
install -d -m 700 /opt/dosvyazi/monitoring /opt/dosvyazi/metrics
install -m 600 deploy/metrics/collect.py /opt/dosvyazi/monitoring/collect.py
install -m 644 deploy/metrics/dosvyazi-metrics.service /etc/systemd/system/
install -m 644 deploy/metrics/dosvyazi-metrics.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/dosvyazi-metrics.service /etc/systemd/system/dosvyazi-metrics.timer
systemctl daemon-reload
systemctl enable --now dosvyazi-metrics.timer
systemctl start dosvyazi-metrics.service
```

Root access permits selected Docker inspect fields and container cgroup counters. The oneshot unit restricts writable paths, address families, memory and CPU, runs at low priority, and exits after each sample. It never reads Docker environment variables or container logs. The directory is root-only and files are private. Validate collection with `systemctl status dosvyazi-metrics.timer`, `journalctl -u dosvyazi-metrics.service` and the private `latest.json`; no port/firewall changes are needed.

## Recorded values and interpretation

- Host CPU busy, I/O wait and steal percentages over the actual sampling interval, raw CPU ticks, load averages and CPU count. Busy excludes idle, I/O wait and steal; guest fields are not counted twice.
- RAM total/available and estimated use (`total - available`), plus swap use.
- Per-interface received/sent bytes, packet/error/drop counters and byte rates. Interfaces remain separate; adding physical, VPN and loopback counters would count some traffic multiple times.
- Filesystem total/used/available bytes, usage percentage and free inodes for the deployed release filesystem. Once an hour, allocated directory sizes are refreshed for application PostgreSQL data, private files, keys and retained releases; the recorded sample uptime distinguishes these slower measurements from current values.
- Each app container: cumulative CPU/throttling counters, CPU percent where 100% means one core, charged memory, estimated working set (charged memory minus inactive file cache), limit/swap, memory pressure/OOM counters, per-device block-I/O bytes/operations, restart count, state, image and start time.
- UTC timestamp, Linux boot ID, actual interval, release revision and collector checksum. Collection duration is recorded to help assess monitoring overhead; it is not a full CPU-overhead benchmark.

First samples, host reboots, replaced/restarted containers and counter decreases produce unknown rates (`null`), rather than zero or negative resource consumption. Missing container counters are marked unavailable and listed as errors; stopped containers are recorded as stopped. Raw counters remain available for later analysis.

Containers use [host networking](https://docs.docker.com/engine/network/drivers/host/). Network counters belong to the host interfaces, including other services/VPN traffic; they are **not app-only bandwidth measurements**. Use quiet, controlled comparable sessions and account for background traffic. Per-container CPU/memory/I/O remain separately attributable. Minute averages can miss brief peaks, and this collector does not measure client encoding resources, network latency, speech quality or request latency.

Memory definitions follow the [Linux `/proc` documentation](https://www.kernel.org/doc/html/latest/filesystems/proc.html), [cgroup v2 counters](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html) and [Docker cache accounting](https://docs.docker.com/reference/cli/docker/container/stats/). Host and container memory are different views and should not be added together.

## Evidence, export and limits

Records append to `/opt/dosvyazi/metrics/samples-YYYY-MM-DD.jsonl`. `latest.json` holds the latest state; `events.jsonl` holds optional labels. No automatic deletion is performed. Collection stops with a service error at 256 MiB of records or below 512 MiB available disk space. Export/archive evidence and review storage before resuming; do not silently raise the cap on a small host. Failed samples and timer/service errors must be included when interpreting gaps.

Mark sessions with short nonpersonal labels:

```bash
python3 /opt/dosvyazi/monitoring/collect.py --event baseline-idle-start
python3 /opt/dosvyazi/monitoring/collect.py --event baseline-idle-end
```

Export JSONL and collector/source metadata through authorized SSH into ignored `.local/artifacts/`; keep raw evidence unchanged and checksum the exported archive. For optimization comparisons, record the source revision, participants, browser/OS, workload, duration, background services and sampling interval; run a warmup and repeat comparable baseline/changed sessions. Label deployment/smoke periods so they are not confused with idle or friend-test measurements. Automatic resource collection establishes an observation history, not proof that an optimization helped.

Run parser/reset/storage checks on Linux with `python3 -m unittest discover -s deploy/metrics -p 'test_*.py'`. Stop collection reversibly with `systemctl disable --now dosvyazi-metrics.timer`; finish any running oneshot separately if needed. Preserve collected files.
