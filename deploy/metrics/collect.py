#!/usr/bin/env python3
"""Private, bounded Linux host/cgroup-v2 samples; Python standard library only."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

SERVICES = ("api", "database", "livekit", "caddy")
CAP_BYTES = 256 * 1024 * 1024
MIN_FREE_BYTES = 512 * 1024 * 1024


def pairs(text):
    return {key: int(value) for key, value in (line.split() for line in text.splitlines())}


def delta(current, previous, seconds):
    """A reset/absent previous counter has no meaningful rate, never zero traffic."""
    if previous is None or seconds <= 0 or current < previous:
        return None
    return (current - previous) / seconds


def cpu_rates(current, previous):
    if not previous or len(current) != 8 or len(previous) != 8 or any(a < b for a, b in zip(current, previous)):
        return None
    changes = [a - b for a, b in zip(current[:8], previous[:8])]
    total = sum(changes)  # guest/guest_nice already belong to user/nice; do not double count.
    if total <= 0:
        return None
    return {"busy_percent": 100 * (total - changes[3] - changes[4] - changes[7]) / total,
            "iowait_percent": 100 * changes[4] / total, "steal_percent": 100 * changes[7] / total}


def memory(text):
    values = {key.rstrip(":"): int(value) * 1024 for key, value, *_ in
              (line.split() for line in text.splitlines())}
    return {"total_bytes": values["MemTotal"], "available_bytes": values["MemAvailable"],
            "used_estimate_bytes": values["MemTotal"] - values["MemAvailable"],
            "swap_total_bytes": values["SwapTotal"],
            "swap_used_bytes": values["SwapTotal"] - values["SwapFree"]}


def network(text, old, seconds):
    result = {}
    for line in text.splitlines()[2:]:
        name, fields = line.split(":", 1)
        data = [int(value) for value in fields.split()]
        counters = dict(zip(("rx_bytes", "rx_packets", "rx_errors", "rx_drops",
                             "tx_bytes", "tx_packets", "tx_errors", "tx_drops"), data[:4] + data[8:12]))
        name = name.strip()
        result[name] = {**counters, **{key + "_per_second": delta(counters[key], old.get(name, {}).get(key), seconds)
                                     for key in ("rx_bytes", "tx_bytes")}}
    return result


def filesystem(path):
    stat = os.statvfs(path)
    total = stat.f_blocks * stat.f_frsize
    return {"total_bytes": total, "used_bytes": (stat.f_blocks - stat.f_bfree) * stat.f_frsize,
            "available_bytes": stat.f_bavail * stat.f_frsize, "free_bytes": stat.f_bfree * stat.f_frsize,
            "used_percent": 100 * (stat.f_blocks - stat.f_bfree) / stat.f_blocks,
            "inodes_total": stat.f_files, "inodes_free": stat.f_ffree}


def command(args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          text=True, timeout=5).stdout


def container(service, previous, seconds):
    # Select metadata fields explicitly. Never read/record Docker environment, secrets, logs or user data.
    template = '{"id":{{json .Id}},"pid":{{.State.Pid}},"image":{{json .Config.Image}},' \
               '"status":{{json .State.Status}},"oom_killed":{{.State.OOMKilled}},' \
               '"restarts":{{.RestartCount}},"started_at":{{json .State.StartedAt}}}'
    item = json.loads(command(["docker", "inspect", "--format", template, f"dosvyazi-vps-{service}-1"]))
    pid = item.pop("pid")
    if item["status"] != "running" or pid <= 0:
        return item
    group = next(line[3:] for line in Path(f"/proc/{pid}/cgroup").read_text().splitlines() if line.startswith("0::"))
    base = Path("/sys/fs/cgroup") / group.lstrip("/")
    base.resolve().relative_to(Path("/sys/fs/cgroup"))
    cpu = pairs((base / "cpu.stat").read_text())
    stats = pairs((base / "memory.stat").read_text())
    current = int((base / "memory.current").read_text())
    limit = (base / "memory.max").read_text().strip()
    io = {}
    for line in (base / "io.stat").read_text().splitlines():
        device, *values = line.split()
        io[device] = {key: int(value) for key, value in (v.split("=") for v in values)}
    same = item["id"] == previous.get("id") and item["started_at"] == previous.get("started_at")
    usage = delta(cpu["usage_usec"], previous.get("cpu", {}).get("usage_usec") if same else None, seconds)
    return {**item, "cpu": cpu, "cpu_percent_one_core": None if usage is None else usage / 10000,
            "memory_current_bytes": current, "memory_working_set_estimate_bytes": max(0, current - stats.get("inactive_file", 0)),
            "memory_limit_bytes": None if limit == "max" else int(limit),
            "swap_bytes": int((base / "memory.swap.current").read_text()),
            "memory_events": pairs((base / "memory.events").read_text()), "io": io}


def collect(previous, release_path):
    started = time.monotonic()
    boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    uptime = float(Path("/proc/uptime").read_text().split()[0])
    old = previous if previous.get("boot_id") == boot else {}
    seconds = uptime - old.get("uptime_seconds", uptime)
    ticks = [int(value) for value in Path("/proc/stat").read_text().splitlines()[0].split()[1:9]]
    errors = []
    containers = {}
    for service in SERVICES:
        try:
            containers[service] = container(service, old.get("containers", {}).get(service, {}), seconds)
        except (OSError, ValueError, StopIteration, subprocess.SubprocessError):
            containers[service] = {"unavailable": True}
            errors.append(service + " counters unavailable")
    try:
        release = json.loads((release_path / "release.json").read_text())
        release = {key: release.get(key) for key in ("id", "revision", "apiRevision", "builtAt")}
    except (OSError, ValueError):
        release = None
        errors.append("release metadata unavailable")
    sizes = old.get("application_directory_sizes")
    if not sizes or uptime - sizes["sampled_uptime_seconds"] >= 3600:
        try:
            paths = [release_path.parent / "data" / name for name in ("postgres", "files", "keys")]
            paths.append(release_path.parent / "releases")
            output = command(["du", "-s", "-B1", "--", *map(str, paths)])
            sizes = {"sampled_uptime_seconds": uptime, "allocated_bytes": {
                Path(name).name: int(size) for size, name in (line.split("\t", 1) for line in output.splitlines())}}
        except (OSError, ValueError, subprocess.SubprocessError):
            sizes = None
            errors.append("application directory sizes unavailable")
    item = {"schema_version": 1, "utc": dt.datetime.now(dt.timezone.utc).isoformat(), "boot_id": boot,
            "uptime_seconds": uptime, "interval_seconds": seconds if old else None,
            "release": release, "collector_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "host": {"cpu_count": os.cpu_count(), "cpu_ticks": ticks, "cpu": cpu_rates(ticks, old.get("host", {}).get("cpu_ticks")),
                     "load_average": list(os.getloadavg()), "memory": memory(Path("/proc/meminfo").read_text()),
                     "network_interfaces": network(Path("/proc/net/dev").read_text(), old.get("host", {}).get("network_interfaces", {}), seconds),
                     "filesystem": filesystem(release_path)},
            "containers": containers, "application_directory_sizes": sizes, "errors": errors}
    item["collector_duration_ms"] = (time.monotonic() - started) * 1000
    return item


def write_record(directory, item):
    files = [*directory.glob("samples-*.jsonl"), directory / "events.jsonl"]
    size = sum(path.stat().st_size for path in files if path.exists())
    encoded = json.dumps(item, separators=(",", ":"), allow_nan=False) + "\n"
    if size + len(encoded.encode()) > CAP_BYTES or filesystem(directory)["available_bytes"] < MIN_FREE_BYTES:
        raise RuntimeError("Metrics storage limit reached; export/archive data before resuming. No records deleted.")
    filename = "events.jsonl" if item.get("kind") == "event" else "samples-" + item["utc"][:10] + ".jsonl"
    with (directory / filename).open("a", encoding="utf-8") as output:
        output.write(encoded)
        output.flush()
        os.fsync(output.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("/opt/dosvyazi/metrics"))
    parser.add_argument("--release", type=Path, default=Path("/opt/dosvyazi/current"))
    parser.add_argument("--event", help="Short test/deployment marker; use no personal information")
    args = parser.parse_args()
    os.umask(0o077)
    args.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (args.directory / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.event:
            if not re.fullmatch(r"[a-zA-Z0-9_.:-]{1,80}", args.event):
                parser.error("Use 1-80 letters, numbers, underscore, dot, colon or hyphen for markers.")
            write_record(args.directory, {"kind": "event", "utc": dt.datetime.now(dt.timezone.utc).isoformat(), "label": args.event})
            return
        state = args.directory / "latest.json"
        try:
            previous = json.loads(state.read_text())
        except (OSError, ValueError):
            previous = {}
        item = collect(previous, args.release)
        write_record(args.directory, item)
        temporary = state.with_suffix(".next")
        temporary.write_text(json.dumps(item, allow_nan=False), encoding="utf-8")
        temporary.replace(state)


if __name__ == "__main__":
    main()
