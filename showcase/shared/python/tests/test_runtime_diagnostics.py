"""Behavior tests for the independent, opt-in runtime observer."""

import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "tools/runtime_diagnostics.py"
ROOT = Path(__file__).resolve().parents[4]
spec = importlib.util.spec_from_file_location("runtime_diagnostics", MODULE)
diag = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = diag
spec.loader.exec_module(diag)


def stat(pid=42, ticks=100, start=10, comm="private (name) with spaces)"):
    fields = ["0"] * 22
    for index, value in {0: "S", 1: 1, 11: ticks, 12: 0, 17: 3, 19: start, 21: 20}.items():
        fields[index] = str(value)
    return f"{pid} ({comm}) " + " ".join(fields)


class Server:
    """Actual loopback socket peer, including silence and trickling status lines."""

    def __init__(self, mode="200"):
        self.mode = mode
        self.stop = threading.Event()
        self.socket = socket.socket()
        self.socket.bind(("127.0.0.1", 0))
        self.port = self.socket.getsockname()[1]
        self.socket.listen()
        self.socket.settimeout(0.05)
        self.thread = threading.Thread(target=self.serve)
        self.thread.start()

    def serve(self):
        while not self.stop.is_set():
            try:
                conn, _ = self.socket.accept()
            except socket.timeout:
                continue
            with conn:
                conn.settimeout(0.2)
                try:
                    conn.recv(1024)
                    if self.mode == "hang":
                        self.stop.wait(0.5)
                    elif self.mode == "trickle":
                        for byte in b"HTTP/1.1 200 OK\r\n":
                            conn.sendall(bytes([byte]))
                            if self.stop.wait(0.03):
                                break
                    else:
                        conn.sendall(f"HTTP/1.1 {self.mode} result\r\nLocation: http://secret.invalid/\r\n\r\nSECRET BODY".encode())
                except OSError:
                    pass

    def close(self):
        self.stop.set()
        self.thread.join(timeout=1)
        self.socket.close()
        assert not self.thread.is_alive()


class DiagnosticsTests(unittest.TestCase):
    def test_parse_and_cpu_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = Path(tmp)
            p = proc / "42"
            p.mkdir()
            (p / "stat").write_text(stat())
            sampler = diag.ProcessSampler(proc, clock_ticks=100, page_size=4096)
            first = sampler.sample(10, 12)
            self.assertIsNone(first["processes"][0]["cpu_percent"])
            (p / "stat").write_text(stat(ticks=300))
            row = sampler.sample(12, 12)["processes"][0]
            self.assertEqual(row["cpu_percent"], 100)
            self.assertEqual(row["rss_bytes"], 81920)
            self.assertEqual(row["threads"], 3)
            (p / "stat").write_text(stat(ticks=900, start=11))
            self.assertIsNone(sampler.sample(14, 12)["processes"][0]["cpu_percent"])
            (p / "stat").write_text("malformed secret")
            bad = sampler.sample(16, 12)
            self.assertEqual(bad["errors"]["malformed"], 1)
            self.assertEqual(bad["processes"], [])
            self.assertNotIn("secret", diag.encode_record(bad))

    def test_config_bounded_and_private(self):
        for value in ("nan", "inf", "-inf", "secret", ""):
            config = diag.Config.from_env(8080, {"SHOWCASE_RUNTIME_DIAGNOSTICS_INTERVAL": value})
            self.assertEqual(config.interval, 30)
            if value:
                self.assertNotIn(value, json.dumps(config.errors))
            for key in ("SHOWCASE_RUNTIME_DIAGNOSTICS_TIMEOUT", "SHOWCASE_RUNTIME_DIAGNOSTICS_TOP"):
                other = diag.Config.from_env(8080, {key: value})
                self.assertEqual((other.timeout, other.top), (2, 12))
        low = diag.Config.from_env(8080, {"SHOWCASE_RUNTIME_DIAGNOSTICS_INTERVAL": "-1", "SHOWCASE_RUNTIME_DIAGNOSTICS_TIMEOUT": "0", "SHOWCASE_RUNTIME_DIAGNOSTICS_TOP": "0"})
        self.assertEqual((low.interval, low.timeout, low.top), (5, 0.1, 1))
        high = diag.Config.from_env(8080, {"SHOWCASE_RUNTIME_DIAGNOSTICS_INTERVAL": "999", "SHOWCASE_RUNTIME_DIAGNOSTICS_TIMEOUT": "999", "SHOWCASE_RUNTIME_DIAGNOSTICS_TOP": "999"})
        self.assertEqual((high.interval, high.timeout, high.top), (300, 5, 32))
        with self.assertRaises(ValueError):
            diag.Config.from_env(70000, {})

    def test_probe_deadline_status_and_privacy(self):
        for mode, expected in (("200", "ok"), ("503", "http_error"), ("302", "http_error"), ("hang", "timeout"), ("trickle", "timeout")):
            server = Server(mode)
            try:
                before = time.monotonic()
                result = diag.probe(server.port, "/health", 0.1)
                self.assertLess(time.monotonic() - before, 0.3)
                self.assertEqual(result["result"], expected)
                self.assertNotIn("SECRET", json.dumps(result))
                self.assertNotIn("secret.invalid", json.dumps(result))
            finally:
                server.close()

    def test_proxy_environment_is_ignored(self):
        server = Server()
        try:
            with patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:1", "http_proxy": "http://127.0.0.1:1", "ALL_PROXY": "http://127.0.0.1:1", "NO_PROXY": ""}):
                self.assertEqual(diag.probe(server.port, "/health", 0.1)["result"], "ok")
        finally:
            server.close()

    def test_output_ceiling_and_disappearing_process(self):
        record = {"schema_version": 1, "processes": [{"pid": i, "rss_bytes": 10**50} for i in range(1000)]}
        encoded = diag.encode_record(record)
        self.assertLessEqual(len(encoded.encode()), 16384)
        self.assertTrue(json.loads(encoded)["output_truncated"])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "1"
            path.mkdir()
            sampler = diag.ProcessSampler(Path(tmp))
            self.assertEqual(sampler.sample(1, 12)["errors"]["unavailable"], 1)
            path.rmdir()
            self.assertEqual(sampler.sample(2, 12)["processes"], [])

    def test_executable_emits_two_records_and_stops_cleanly(self):
        server = Server()
        child = subprocess.Popen([sys.executable, "-I", "-B", str(MODULE), "--frontend-port", str(server.port)], env={**os.environ, "SHOWCASE_RUNTIME_DIAGNOSTICS_INTERVAL": "5", "SHOWCASE_RUNTIME_DIAGNOSTICS_TIMEOUT": "0.1"}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            time.sleep(5.4)
            child.terminate()
            output, errors = child.communicate(timeout=2)
            self.assertEqual(child.returncode, 0, errors)
            records = [json.loads(line) for line in output.splitlines()]
            self.assertEqual(len(records), 2)
            for record in records:
                self.assertEqual(record["health"]["frontend"]["result"], "ok")
                self.assertLessEqual(len(diag.encode_record(record).encode()), 16384)
            self.assertGreaterEqual(records[1]["cpu_interval_seconds"], 4.9)
        finally:
            if child.poll() is None:
                child.kill()
                child.communicate(timeout=2)
            server.close()

    def test_peer_hang_does_not_skip_probe_and_records_bounded(self):
        for front_mode, back_mode in (("hang", "200"), ("200", "hang"), ("hang", "hang")):
            front, back = Server(front_mode), Server(back_mode)
            try:
                sampler = diag.ProcessSampler(Path("/nonexistent"))
                config = diag.Config.from_env(front.port, {"SHOWCASE_RUNTIME_DIAGNOSTICS_TIMEOUT": "0.1"})
                before = time.monotonic()
                for _ in range(2):
                    record = diag.snapshot(config, sampler, backend_port=back.port)
                    self.assertEqual(record["health"]["frontend"]["result"], "timeout" if front_mode == "hang" else "ok")
                    self.assertEqual(record["health"]["backend"]["result"], "timeout" if back_mode == "hang" else "ok")
                    self.assertLessEqual(len(diag.encode_record(record).encode()), 16384)
                self.assertLess(time.monotonic() - before, 0.8)
            finally:
                front.close()
                back.close()

    def test_process_row_cap_and_no_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = Path(tmp)
            for pid in range(1, 80):
                path = proc / str(pid)
                path.mkdir()
                (path / "stat").write_text(stat(pid=pid, comm="CUSTOMER SECRET"))
            sample = diag.ProcessSampler(proc).sample(1, 12)
            self.assertLessEqual(len(sample["processes"]), 12)
            self.assertEqual(sample["process_count"], 79)
            self.assertNotIn("CUSTOMER", diag.encode_record(sample))

    @unittest.skipUnless(sys.platform == "linux", "requires actual Linux /proc")
    def test_actual_busy_and_sleeping_processes(self):
        busy = subprocess.Popen([sys.executable, "-c", "while True: pass"])
        sleepy = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            sampler = diag.ProcessSampler()
            sampler.sample(time.monotonic(), 32)
            time.sleep(0.4)
            rows = {r["pid"]: r for r in sampler.sample(time.monotonic(), 32)["processes"]}
            self.assertGreater(rows[busy.pid]["cpu_percent"], rows[sleepy.pid]["cpu_percent"] + 5)
            busy.terminate()
            busy.wait(timeout=2)
            sampler.sample(time.monotonic(), 32)
            self.assertIsNone(sleepy.poll())
        finally:
            for child in (busy, sleepy):
                if child.poll() is None:
                    child.terminate()
                child.wait(timeout=2)

    @unittest.skipUnless(sys.platform == "linux", "requires Bash wait -n and /proc")
    def test_shipped_entrypoint_lifecycle(self):
        for enabled, watcher_failure in ((False, False), (True, False), (True, True)):
            with self.subTest(enabled=enabled, watcher_failure=watcher_failure), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)
                entry = ROOT / "showcase/integrations/google-antigravity/entrypoint.sh"
                (directory / "entrypoint.sh").write_text(entry.read_text())
                (directory / "tools").mkdir()
                (directory / "tools/runtime_diagnostics.py").write_text(MODULE.read_text())
                shims = directory / "bin"
                shims.mkdir()
                shim = "#!/bin/bash\nif [[ $* == *runtime_diagnostics.py* ]]; then\n  echo $$ > \"$PID_DIR/watcher\"\n  if [ \"$WATCHER_FAIL\" = 1 ]; then exit 1; fi\n  exec \"$REAL_PYTHON\" \"$@\"\nfi\necho $$ > \"$PID_DIR/agent\"\nexec sleep 30\n"
                for name, content in (("python", shim), ("npx", '#!/bin/bash\necho $$ > "$PID_DIR/frontend"\nexec sleep 30\n'), ("curl", "#!/bin/bash\nexit 0\n")):
                    p = shims / name
                    p.write_text(content)
                    p.chmod(0o755)
                env = {**os.environ, "PATH": str(shims) + ":" + os.environ["PATH"], "GEMINI_API_KEY": "fake-for-startup", "PID_DIR": str(directory), "REAL_PYTHON": sys.executable, "WATCHER_FAIL": "1" if watcher_failure else "0", "SHOWCASE_RUNTIME_DIAGNOSTICS": "1" if enabled else "0", "SHOWCASE_RUNTIME_DIAGNOSTICS_TIMEOUT": "0.1"}
                output = directory / "output"
                with output.open("w") as log:
                    shell = subprocess.Popen(["bash", str(directory / "entrypoint.sh")], cwd=directory, env=env, stdout=log, stderr=log)
                children = []
                try:
                    deadline = time.monotonic() + 6
                    while time.monotonic() < deadline:
                        if (directory / "frontend").exists() and (not enabled or (directory / "watcher").exists()):
                            if watcher_failure or not enabled or '"schema_version"' in output.read_text():
                                break
                        time.sleep(0.05)
                    self.assertIsNone(shell.poll(), output.read_text())
                    children = [int((directory / name).read_text()) for name in ("agent", "frontend")]
                    for pid in children:
                        os.kill(pid, 0)
                    self.assertEqual((directory / "watcher").exists(), enabled)
                    if enabled and not watcher_failure:
                        self.assertIn('"schema_version"', output.read_text())
                    os.kill(children[1], 15)
                    shell.wait(timeout=3)
                    if enabled and not watcher_failure:
                        watcher = int((directory / "watcher").read_text())
                        deadline = time.monotonic() + 1
                        while Path(f"/proc/{watcher}").exists() and time.monotonic() < deadline:
                            time.sleep(0.02)
                        self.assertFalse(Path(f"/proc/{watcher}").exists())
                finally:
                    if shell.poll() is None:
                        shell.terminate()
                        shell.wait(timeout=3)
                    for pid in children:
                        try:
                            os.kill(pid, 15)
                        except ProcessLookupError:
                            pass


if __name__ == "__main__":
    unittest.main()
