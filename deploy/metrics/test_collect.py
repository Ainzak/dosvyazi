"""Counter semantics and bounded evidence retention; run on Linux with unittest."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import collect


class ResourceEvidenceTests(unittest.TestCase):
    def test_resets_and_missing_counters_are_unknown_not_zero(self):
        self.assertIsNone(collect.delta(100, None, 60))
        self.assertIsNone(collect.delta(50, 100, 60))
        self.assertIsNone(collect.delta(100, 50, 0))
        self.assertEqual(collect.delta(200, 80, 60), 2)

    def test_cpu_does_not_double_count_guest_and_separates_wait_and_steal(self):
        self.assertEqual(collect.cpu_rates([20, 0, 10, 50, 10, 0, 0, 10], [0] * 8),
                         {"busy_percent": 30, "iowait_percent": 10, "steal_percent": 10})
        self.assertIsNone(collect.cpu_rates([0] * 8, [1] * 8))
        self.assertIsNone(collect.cpu_rates([1] * 8, []))

    def test_memory_uses_available_and_swap_bytes(self):
        item = collect.memory("MemTotal: 1024 kB\nMemAvailable: 256 kB\nSwapTotal: 512 kB\nSwapFree: 400 kB")
        self.assertEqual(item["used_estimate_bytes"], 768 * 1024)
        self.assertEqual(item["swap_used_bytes"], 112 * 1024)

    def test_interfaces_stay_separate_and_reset_is_unknown(self):
        text = "header\nheader\neth0: 120 2 0 0 0 0 0 0 250 3 0 0 0 0 0 0\nawg0: 100 1 0 0 0 0 0 0 110 1 0 0 0 0 0 0"
        item = collect.network(text, {"eth0": {"rx_bytes": 60, "tx_bytes": 300}}, 60)
        self.assertEqual(item["eth0"]["rx_bytes_per_second"], 1)
        self.assertIsNone(item["eth0"]["tx_bytes_per_second"])
        self.assertIsNone(item["awg0"]["rx_bytes_per_second"])
        self.assertEqual(set(item), {"eth0", "awg0"})

    def test_container_restart_has_no_spurious_cpu_rate(self):
        metadata = {"id": "same-id", "pid": 123, "image": "test-image", "status": "running",
                    "oom_killed": False, "restarts": 1, "started_at": "new-start"}
        fixture = {"cgroup": "0::/sample", "cpu.stat": "usage_usec 2000000\nnr_throttled 0",
                   "memory.stat": "inactive_file 100", "memory.current": "500", "memory.max": "1000",
                   "memory.swap.current": "0", "memory.events": "oom_kill 0", "io.stat": "8:0 rbytes=10 wbytes=20"}
        previous = {"id": "same-id", "started_at": "old-start", "cpu": {"usage_usec": 1000000}}
        with patch.object(collect, "command", return_value=json.dumps(metadata)), \
                patch.object(Path, "read_text", lambda path: fixture[path.name]):
            item = collect.container("api", previous, 60)
            self.assertIsNone(item["cpu_percent_one_core"])
            self.assertEqual(item["memory_working_set_estimate_bytes"], 400)
            previous["started_at"] = "new-start"
            self.assertAlmostEqual(collect.container("api", previous, 60)["cpu_percent_one_core"], 1.66666667)

    def test_cap_preserves_previous_records_and_disk_reserve(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            item = {"utc": "2026-10-15T00:00:00+00:00", "value": 42}
            with patch.object(collect, "filesystem", return_value={"available_bytes": 2**30}):
                collect.write_record(directory, item)
                saved = (directory / "samples-2026-10-15.jsonl").read_bytes()
                with patch.object(collect, "CAP_BYTES", len(saved)):
                    with self.assertRaises(RuntimeError):
                        collect.write_record(directory, item)
                self.assertEqual((directory / "samples-2026-10-15.jsonl").read_bytes(), saved)
            with patch.object(collect, "filesystem", return_value={"available_bytes": 1}):
                with self.assertRaises(RuntimeError):
                    collect.write_record(directory, item)
            self.assertEqual(json.loads(saved), item)


if __name__ == "__main__":
    unittest.main()
