"""Independent stdlib runtime observer. Never controls application processes.

Opt in through the container entrypoint with SHOWCASE_RUNTIME_DIAGNOSTICS=1.
CPU percentages are interval deltas: 100 percent means one occupied CPU core.
Records contain only allowlisted process metadata and loopback health outcomes.
"""

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import signal
import socket
import time

MAX_RECORD_BYTES = 16384
MAX_STATUS_BYTES = 256


@dataclass(frozen=True)
class Config:
    frontend_port: int
    interval: float
    timeout: float
    top: int
    errors: tuple

    @classmethod
    def from_env(cls, frontend_port, env=None):
        if not 1 <= frontend_port <= 65535:
            raise ValueError("invalid_port")
        env = os.environ if env is None else env
        errors = []

        def bounded(name, default, low, high, integer=False):
            try:
                value = float(env.get(name, default))
                if not math.isfinite(value) or (integer and value != int(value)):
                    raise ValueError
            except (ValueError, OverflowError, TypeError):
                value = default
                errors.append("invalid_config")
            value = min(high, max(low, value))
            return int(value) if integer else value

        interval = bounded("SHOWCASE_RUNTIME_DIAGNOSTICS_INTERVAL", 30, 5, 300)
        timeout = bounded("SHOWCASE_RUNTIME_DIAGNOSTICS_TIMEOUT", 2, 0.1, 5)
        top = bounded("SHOWCASE_RUNTIME_DIAGNOSTICS_TOP", 12, 1, 32, True)
        return cls(frontend_port, interval, timeout, top, tuple(errors))


def parse_stat(raw, page_size):
    # comm is parenthesized, may include spaces and ')' characters, and is never
    # returned or logged. Fields after its final ')' have stable kernel indexes.
    end = raw.rfind(")")
    if end < 0:
        raise ValueError("malformed_stat")
    fields = raw[end + 1 :].split()
    pid = int(raw[: raw.index("(")].strip())
    state = fields[0]
    if state not in "RSDZTWtXxKPI" or len(state) != 1:
        raise ValueError("malformed_stat")
    values = [int(fields[i]) for i in (1, 11, 12, 17, 19, 21)]
    if pid < 1 or any(value < 0 for value in values):
        raise ValueError("malformed_stat")
    ppid, user, system, threads, starttime, rss = values
    return {
        "pid": pid,
        "ppid": ppid,
        "state": state,
        "threads": threads,
        "starttime": starttime,
        "ticks": user + system,
        "rss_bytes": rss * page_size,
    }


def runtime_family(path):
    try:
        name = Path(os.readlink(path / "exe")).name
    except OSError:
        return "other"
    if name in ("node", "nodejs"):
        return "node"
    if name == "python" or name == "python3" or name.startswith("python3."):
        return "python"
    if name in ("antigravity", "antigravity-harness"):
        return "harness"
    return "other"


class ProcessSampler:
    def __init__(self, proc=Path("/proc"), clock_ticks=None, page_size=None):
        self.proc = Path(proc)
        self.clock_ticks = clock_ticks or os.sysconf("SC_CLK_TCK")
        self.page_size = page_size or os.sysconf("SC_PAGE_SIZE")
        self.previous = {}
        self.previous_time = None

    def sample(self, now, top):
        errors = {"unavailable": 0, "malformed": 0}
        rows, current = [], {}
        elapsed = now - self.previous_time if self.previous_time is not None else 0
        try:
            paths = list(self.proc.iterdir())
        except OSError:
            paths = []
            errors["unavailable"] += 1
        for path in paths:
            if not path.name.isascii() or not path.name.isdecimal():
                continue
            try:
                row = parse_stat((path / "stat").read_text(), self.page_size)
                if row["pid"] != int(path.name):
                    raise ValueError
            except OSError:
                errors["unavailable"] += 1
                continue
            except (ValueError, IndexError):
                errors["malformed"] += 1
                continue
            identity = (row["pid"], row["starttime"])
            ticks = row.pop("ticks")
            current[identity] = ticks
            prior = self.previous.get(identity)
            cpu = None
            if prior is not None and elapsed > 0 and ticks >= prior:
                cpu = round((ticks - prior) / self.clock_ticks / elapsed * 100, 2)
            row["cpu_percent"] = cpu
            row["runtime"] = runtime_family(path)
            rows.append(row)
        self.previous, self.previous_time = current, now
        # Reserve half the bounded rows for CPU and fill from RSS leaders;
        # duplicate leaders count once. This exposes both compute and memory.
        cpu_sorted = sorted(
            rows, key=lambda r: (r["cpu_percent"] or 0, r["rss_bytes"]), reverse=True
        )
        selected = cpu_sorted[: (top + 1) // 2]
        seen = {r["pid"] for r in selected}
        for row in sorted(rows, key=lambda r: r["rss_bytes"], reverse=True):
            if len(selected) >= top:
                break
            if row["pid"] not in seen:
                selected.append(row)
                seen.add(row["pid"])
        return {
            "processes": selected,
            "process_count": len(rows),
            "errors": errors,
            "cpu_interval_seconds": round(elapsed, 3) if elapsed > 0 else None,
        }


def probe(port, path, timeout):
    """Read only a capped status line; direct loopback bypasses proxies and DNS."""
    started = time.monotonic()
    deadline = started + timeout
    result, status = "io_error", None
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as conn:

            def remaining():
                left = deadline - time.monotonic()
                if left <= 0:
                    raise TimeoutError
                conn.settimeout(left)

            remaining()
            conn.connect(("127.0.0.1", port))
            remaining()
            conn.sendall(
                f"GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n".encode(
                    "ascii"
                )
            )
            line = bytearray()
            while len(line) < MAX_STATUS_BYTES:
                remaining()
                byte = conn.recv(1)
                if not byte:
                    break
                line.extend(byte)
                if byte == b"\n":
                    break
            parts = bytes(line).split(b" ", 2)
            if (
                line.endswith(b"\r\n")
                and len(parts) == 3
                and parts[0] in (b"HTTP/1.0", b"HTTP/1.1")
                and len(parts[1]) == 3
                and parts[1].isdigit()
                and 100 <= int(parts[1]) <= 599
            ):
                status = int(parts[1])
                result = "ok" if 200 <= status < 300 else "http_error"
            else:
                result = "invalid_status"
    except (TimeoutError, socket.timeout):
        result = "timeout"
    except OSError:
        result = "io_error"
    return {
        "result": result,
        "status": status,
        "elapsed_ms": round((time.monotonic() - started) * 1000, 1),
    }


def snapshot(config, sampler, backend_port=8000):
    record = {
        "schema_version": 1,
        "kind": "showcase_runtime_diagnostics",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "config_errors": list(config.errors),
    }
    record.update(sampler.sample(time.monotonic(), config.top))
    record["health"] = {
        "frontend": probe(config.frontend_port, "/api/health", config.timeout),
        "backend": probe(backend_port, "/health", config.timeout),
    }
    return record


def encode_record(record):
    # All production strings are fixed codes. Enforce a final size ceiling even
    # if unexpectedly huge numeric process metadata consumes the row budget.
    encoded = json.dumps(record, separators=(",", ":"), allow_nan=False)
    if len(encoded.encode("utf-8")) > MAX_RECORD_BYTES:
        record = {**record, "processes": [], "output_truncated": True}
        encoded = json.dumps(record, separators=(",", ":"), allow_nan=False)
    if len(encoded.encode("utf-8")) > MAX_RECORD_BYTES:
        return '{"schema_version":1,"kind":"showcase_runtime_diagnostics","error":"output_limit"}'
    return encoded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-port", type=int, required=True)
    args = parser.parse_args()
    try:
        config = Config.from_env(args.frontend_port)
    except ValueError:
        return 1
    running = True

    def stop(_signum, _frame):
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    sampler = ProcessSampler()
    while running:
        started = time.monotonic()
        record = snapshot(config, sampler)
        try:
            print(encode_record(record), flush=True)
        except (OSError, ValueError):
            return 1
        # Signal handlers interrupt the lifecycle without controlling apps.
        until = started + config.interval
        while running and time.monotonic() < until:
            time.sleep(min(0.1, max(0, until - time.monotonic())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
