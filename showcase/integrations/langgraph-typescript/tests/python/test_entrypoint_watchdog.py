"""Subprocess tests for entrypoint.sh watchdog / persistence-bounding mechanism.

Current mechanism (permanent LGT outage fix):
  - Persistence disable: `LANGGRAPH_DISABLE_FILE_PERSISTENCE=true` is exported
    before the agent starts, and src/agent/disable-file-persistence.mjs (a
    `node --import` preload) neutralises every @langchain/langgraph-api fs write
    surface for the `.langgraph_api` persist dir, so it never grows on disk.
  - Boot-purge: any pre-existing `.langgraph_api` is removed on every start.
  - Size-gated restart: a defense-in-depth watchdog sub-loop kills the agent
    (triggering a container restart + boot-purge) only if the persist dir ever
    DOES exceed SIZE_THRESHOLD_MB — not on a fixed timer.
  - Sub-loop reaping: the watchdog subshell arms `trap _reap_watchdog_children
    EXIT`, which reaps the size sub-loop via a `$BASHPID` PPID-walk plus a direct
    `kill "$SIZE_PID"` backstop, so no orphan outlives the watchdog.

Historical context (guarded against regression, no longer the mechanism):
  - An earlier design POSTed to /internal/truncate on a fixed timer. That was
    removed: under `set -e` a bare `TRUNC_RESPONSE=$(curl -fsS ...)` exited the
    subshell on the first non-2xx (dead code), and /internal/truncate wipes ALL
    in-flight runs/threads. The truncate-absence tests below assert that dead
    code stays gone.

We stub node/npm/npx/curl via PATH prepend (same pattern as google-adk tests).
The stub executables exit 0 immediately so the script can progress through the
boot-purge section and we observe behavior without actually launching the stack.

For size-gate behavioral tests, we use the --check-size-once seam:
  bash entrypoint.sh --check-size-once
This executes exactly one size-check-and-kill cycle using env vars for
configuration, with a stubbed `du` on PATH returning a controlled value.
This allows mutation-sensitive tests that catch reversed comparisons or broken
du|awk extraction.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from textwrap import dedent
from typing import NamedTuple

import pytest


def _indent(text, spaces):
    pad = " " * spaces
    return "\n".join(pad + line if line else line for line in text.splitlines())


_PKG_ROOT = Path(__file__).resolve().parents[2]
_ENTRYPOINT = _PKG_ROOT / "entrypoint.sh"


class CheckSizeResult(NamedTuple):
    """Return value of _run_check_size_once.

    result:          CompletedProcess from the entrypoint --check-size-once run.
    dummy_was_killed: True if the dummy agent process was killed by the gate
                      (poll() returned non-None before the finally reaper ran);
                      False if it was still alive (gate did not fire).
    """

    result: subprocess.CompletedProcess
    dummy_was_killed: bool


def _make_stubs(
    stub_dir: Path,
    *,
    curl_truncate_rc: int = 0,
    du_size_mb: int | None = None,
) -> None:
    """Create stub binaries in stub_dir.

    curl stub: all requests exit 0 (liveness probes pass).
    node / npm / npx → exit 0 immediately.
    du stub: if du_size_mb is set, returns that value as the size output;
      otherwise falls through to the real du.
    """
    stub_dir.mkdir(parents=True, exist_ok=True)

    curl_script = dedent(f"""\
        #!/bin/sh
        # Detect which URL is being called by scanning positional args
        for arg in "$@"; do
          case "$arg" in
            *8123/internal/truncate*)
              exit {curl_truncate_rc}
              ;;
          esac
        done
        # Default: succeed (liveness probes, etc.)
        exit 0
    """)
    (stub_dir / "curl").write_text(curl_script)
    (stub_dir / "curl").chmod(0o755)

    for name in ("node", "npm", "npx"):
        stub = stub_dir / name
        stub.write_text("#!/bin/sh\nexit 0\n")
        stub.chmod(0o755)

    if du_size_mb is not None:
        # Stub du to return a controlled size regardless of the actual dir.
        # Mimics `du -sm <dir>` output format: "<size_mb>\t<path>"
        du_script = dedent(f"""\
            #!/bin/sh
            # Return controlled size for any argument
            last_arg=""
            for arg in "$@"; do
              case "$arg" in
                -*) ;;
                *) last_arg="$arg" ;;
              esac
            done
            echo "{du_size_mb}\t${{last_arg:-.}}"
            exit 0
        """)
        (stub_dir / "du").write_text(du_script)
        (stub_dir / "du").chmod(0o755)


def _run_entrypoint(
    tmp_path: Path,
    *,
    extra_env: dict[str, str] | None = None,
    stub_curl_truncate_rc: int = 0,
    timeout: int = 10,
) -> subprocess.CompletedProcess:
    stub_dir = tmp_path / "stubs"
    _make_stubs(stub_dir, curl_truncate_rc=stub_curl_truncate_rc)

    persist_dir = tmp_path / "langgraph_api"
    clean_env = {
        "PATH": f"{stub_dir}:{os.environ.get('PATH', '/usr/bin:/bin')}",
        "HOME": os.environ.get("HOME", "/tmp"),
        "PORT": "10000",
        # Allow PERSIST_DIR to be overridden for testing without Docker
        "LANGGRAPH_PERSIST_DIR_OVERRIDE": str(persist_dir),
    }
    if extra_env:
        clean_env.update(extra_env)

    return subprocess.run(
        ["/bin/bash", str(_ENTRYPOINT)],
        env=clean_env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _run_check_size_once(
    tmp_path: Path,
    *,
    persist_dir: Path,
    size_threshold_mb: int,
    du_size_mb: int,
    timeout: int = 5,
) -> CheckSizeResult:
    """Run entrypoint.sh --check-size-once with a stubbed du returning du_size_mb.

    This exercises the _watchdog_check_size_once seam directly, without needing
    the full entrypoint stack (no cd /app/src/agent, no real npm start, etc.).

    We spawn a real long-running dummy process (sleep 30) as the AGENT_PID so
    that:
      - kill -0 $AGENT_PID succeeds (process is alive), and
      - kill -9 $AGENT_PID terminates the dummy process (not the test runner).

    dummy.poll() is captured BEFORE the finally reaper so callers can assert
    whether the gate actually killed the process (poll() is not None = killed)
    or left it alive (poll() is None = not killed).  The finally block then
    always reaps any survivor so no zombie/orphan remains.
    """
    stub_dir = tmp_path / "stubs_size"
    _make_stubs(stub_dir, du_size_mb=du_size_mb)

    # Spawn a real dummy "agent" process that can safely be killed.
    dummy = subprocess.Popen(["sleep", "30"])
    try:
        clean_env = {
            "PATH": f"{stub_dir}:{os.environ.get('PATH', '/usr/bin:/bin')}",
            "HOME": os.environ.get("HOME", "/tmp"),
            "LANGGRAPH_PERSIST_DIR_OVERRIDE": str(persist_dir),
            "LANGGRAPH_SIZE_THRESHOLD_MB": str(size_threshold_mb),
            "AGENT_PID": str(dummy.pid),
        }

        result = subprocess.run(
            ["/bin/bash", str(_ENTRYPOINT), "--check-size-once"],
            env=clean_env,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        # Capture whether the gate killed the dummy BEFORE the finally reaper
        # runs — once finally calls dummy.kill(), poll() would always be non-None
        # regardless of whether the script killed it.
        #
        # The gate's kill (`kill -9` in _kill_agent_tree) is issued asynchronously
        # right before the entrypoint exits, so `subprocess.run` can return before
        # SIGKILL delivery + zombie reaping have completed. A single-shot poll()
        # can therefore observe the dummy as still alive on a loaded machine (a
        # flaky false-negative). Poll in a bounded retry loop (up to ~1s) to let
        # the async signal land, mirroring the orphan-guard behavioral test.
        import time

        dummy_was_killed = False
        for _ in range(20):
            if dummy.poll() is not None:
                dummy_was_killed = True
                break
            time.sleep(0.05)
        return CheckSizeResult(result=result, dummy_was_killed=dummy_was_killed)
    finally:
        # Reap the dummy process (may already be dead if kill -9 landed).
        dummy.kill()
        dummy.wait(timeout=2)


@pytest.mark.skipif(not _ENTRYPOINT.exists(), reason="entrypoint.sh not found")
class TestBootPurge:
    """Boot-purge (.langgraph_api removal) must fire on every start."""

    def test_purges_existing_persist_dir(self, tmp_path):
        """If persist dir exists at boot, entrypoint must purge it.

        The script will fail at `cd /app/src/agent` (not present outside
        container). We only check that the purge log appears and the dir
        was actually removed — both happen before that cd line.
        """
        persist_dir = tmp_path / "langgraph_api"
        persist_dir.mkdir(parents=True)
        (persist_dir / "state.json").write_text('{"runs":{}}')

        result = _run_entrypoint(
            tmp_path,
            extra_env={"LANGGRAPH_PERSIST_DIR_OVERRIDE": str(persist_dir)},
        )
        output = result.stdout + result.stderr
        assert "Purging stale LangGraph persistence state" in output, (
            f"Expected purge log in output. output={output!r}"
        )
        assert not persist_dir.exists(), (
            "Expected persist dir to be removed by boot-purge"
        )

    def test_clean_boot_logs_no_prior_state(self, tmp_path):
        """If persist dir does NOT exist, entrypoint logs clean boot."""
        persist_dir = tmp_path / "langgraph_api"
        # Do NOT create it

        result = _run_entrypoint(
            tmp_path,
            extra_env={"LANGGRAPH_PERSIST_DIR_OVERRIDE": str(persist_dir)},
        )
        output = result.stdout + result.stderr
        assert "clean boot" in output, (
            f"Expected 'clean boot' log when no prior state. output={output!r}"
        )

    def test_persist_dir_uses_env_override(self):
        """entrypoint.sh must respect LANGGRAPH_PERSIST_DIR_OVERRIDE env var."""
        source = _ENTRYPOINT.read_text()
        assert "LANGGRAPH_PERSIST_DIR_OVERRIDE" in source, (
            "PERSIST_DIR must be overridable via LANGGRAPH_PERSIST_DIR_OVERRIDE "
            "for test isolation (no /app in test environment)"
        )


@pytest.mark.skipif(not _ENTRYPOINT.exists(), reason="entrypoint.sh not found")
class TestFilePersistenceDisabled:
    """FileSystemPersistence disk flush must be disabled — the durable root-cause
    fix for the 2026-07-13 outage.

    The langgraph-python integration (PR #5825) exports
    LANGGRAPH_DISABLE_FILE_PERSISTENCE=true so its inmem runtime never flushes
    unbounded state to disk. The TypeScript stack (@langchain/langgraph-api) has
    no built-in switch, so this integration sets the same env var AND ships a
    preload module (src/agent/disable-file-persistence.mjs, wired into `npm
    start` via `node --import`) that reads it and no-ops the .langgraph_api fs
    writes. If either half is dropped, .langgraph_api grows unbounded under
    probe fan-out and the size-watchdog kill-loops the container again.
    """

    def test_export_runs_before_agent_start(self, tmp_path):
        """Behavioral: the LANGGRAPH_DISABLE_FILE_PERSISTENCE export must actually
        EXECUTE at boot, before the agent is launched.

        Runs the boot sequence under `bash -x` and inspects the execution trace.
        The export line runs before the hardcoded `cd /app/src/agent && npm start`
        (which fails outside a container), so a source-only check is insufficient
        — this proves the statement is on the live boot path, not dead code after
        an early return/guard. We assert the export trace line appears AND that it
        precedes the agent `cd /app/src/agent` trace line.
        """
        stub_dir = tmp_path / "stubs_trace"
        stub_dir.mkdir(parents=True)
        for tool in ("node", "npm", "npx", "next"):
            t = stub_dir / tool
            t.write_text("#!/bin/bash\nexit 0\n")
            t.chmod(0o755)
        curl = stub_dir / "curl"
        curl.write_text("#!/bin/bash\nexit 0\n")
        curl.chmod(0o755)

        persist_dir = tmp_path / "langgraph_api"
        clean_env = {
            "PATH": f"{stub_dir}:{os.environ.get('PATH', '/usr/bin:/bin')}",
            "HOME": os.environ.get("HOME", "/tmp"),
            "PORT": "10000",
            "LANGGRAPH_PERSIST_DIR_OVERRIDE": str(persist_dir),
        }
        try:
            result = subprocess.run(
                ["/bin/bash", "-x", str(_ENTRYPOINT)],
                env=clean_env,
                capture_output=True,
                text=True,
                timeout=8,
            )
            trace = result.stderr
        except subprocess.TimeoutExpired as exc:
            raw = exc.stderr
            trace = raw.decode() if isinstance(raw, (bytes, bytearray)) else (raw or "")

        assert "LANGGRAPH_DISABLE_FILE_PERSISTENCE=true" in trace, (
            "Export of LANGGRAPH_DISABLE_FILE_PERSISTENCE=true must execute at "
            f"boot (not be dead code). trace tail={trace[-1500:]!r}"
        )
        export_pos = trace.index("LANGGRAPH_DISABLE_FILE_PERSISTENCE=true")
        # The agent launch (cd into the agent dir) must come AFTER the export.
        cd_pos = trace.find("cd /app/src/agent")
        assert cd_pos != -1, (
            f"Expected agent-start trace line. trace tail={trace[-1500:]!r}"
        )
        assert export_pos < cd_pos, (
            "The persistence-disable export must execute BEFORE the agent starts."
        )

    def test_env_var_exported_in_source(self):
        """entrypoint.sh must export LANGGRAPH_DISABLE_FILE_PERSISTENCE=true —
        parity with langgraph-python's PR #5825 fix."""
        source = _ENTRYPOINT.read_text()
        assert "export LANGGRAPH_DISABLE_FILE_PERSISTENCE=true" in source, (
            "entrypoint.sh must export LANGGRAPH_DISABLE_FILE_PERSISTENCE=true "
            "to disable FileSystemPersistence disk flush (root-cause fix)."
        )

    def test_preload_module_exists_and_gated(self):
        """The preload module must exist and be gated on the env var (not
        unconditionally patch fs, which would break non-persistence writes)."""
        preload = _PKG_ROOT / "src" / "agent" / "disable-file-persistence.mjs"
        assert preload.exists(), f"Preload module missing at {preload}"
        text = preload.read_text()
        assert "LANGGRAPH_DISABLE_FILE_PERSISTENCE" in text, (
            "Preload must read LANGGRAPH_DISABLE_FILE_PERSISTENCE"
        )
        assert ".langgraph_api" in text, (
            "Preload must scope its fs no-op to the .langgraph_api path"
        )

    def test_start_script_preloads_disable_module(self):
        """src/agent/package.json `start` must preload the disable module via
        `node --import` BEFORE tsx/liveness, or the patch is never installed."""
        import json

        pkg_path = _PKG_ROOT / "src" / "agent" / "package.json"
        pkg = json.loads(pkg_path.read_text())
        start = pkg.get("scripts", {}).get("start", "")
        assert "disable-file-persistence.mjs" in start, (
            f"start script must --import disable-file-persistence.mjs. start={start!r}"
        )
        # The disable module must load BEFORE liveness.mjs (which triggers the
        # heavy server import that touches the filesystem).
        assert start.index("disable-file-persistence.mjs") < start.index(
            "liveness.mjs"
        ), "disable-file-persistence.mjs must be preloaded BEFORE liveness.mjs"

    def test_real_package_writes_are_suppressed_behavioral(self, tmp_path):
        """BEHAVIORAL (real package): with the preload active and the flag ON, the
        REAL @langchain/langgraph-api FileSystemPersistence flush must NOT grow
        `.langgraph_api` on disk, AND an in-memory write/read round-trip must still
        return the value (persistence disabled != conversation capability removed).

        Skipped if the agent's node_modules is not installed (CI matrices that do
        not `npm ci` the agent). When installed, this is the proof that closes the
        stubbed-fs gap: it drives the real writer, not a fake.
        """
        import json
        import shutil

        agent_dir = _PKG_ROOT / "src" / "agent"
        persist_pkg = (
            agent_dir
            / "node_modules"
            / "@langchain"
            / "langgraph-api"
            / "dist"
            / "storage"
            / "persist.mjs"
        )
        # In CI, LGT_REQUIRE_BEHAVIORAL=1 makes a missing runtime a FAILURE, not
        # a skip: the merge-gating job is SUPPOSED to have the package installed,
        # so a silent skip there would let the suite go green without ever
        # exercising the real writer — the exact false-confidence mode this fix
        # exists to prevent. Local dev machines (flag unset) still skip
        # gracefully when the agent deps legitimately are not installed.
        require_behavioral = os.environ.get("LGT_REQUIRE_BEHAVIORAL") == "1"
        if not persist_pkg.exists():
            msg = (
                "agent node_modules not installed (@langchain/langgraph-api) at "
                f"{persist_pkg}"
            )
            if require_behavioral:
                pytest.fail(
                    "LGT_REQUIRE_BEHAVIORAL=1 but " + msg + " — the CI job that "
                    "gates this fix MUST install the agent deps (npm install in "
                    "src/agent) so the real-package interception is actually "
                    "exercised. Refusing to skip the sole behavioral proof."
                )
            pytest.skip(msg)
        node = shutil.which("node")
        if node is None:
            if require_behavioral:
                pytest.fail(
                    "LGT_REQUIRE_BEHAVIORAL=1 but node is not on PATH — the CI job "
                    "must set up Node before running the behavioral proof."
                )
            pytest.skip("node not on PATH")

        run_cwd = tmp_path / "run"
        run_cwd.mkdir()
        driver = tmp_path / "driver.mjs"
        driver.write_text(
            dedent(r"""
            import { pathToFileURL } from "node:url";
            import * as fsSync from "node:fs";
            import * as path from "node:path";
            const persistAbs = process.env.PERSIST_ABS;
            const cwd = process.env.RUN_CWD;
            const { FileSystemPersistence } =
              await import(pathToFileURL(persistAbs).href);
            const conn = new FileSystemPersistence(
              ".langgraphjs_api.checkpointer.json", () => ({ threads: {} }));
            await conn.initialize(cwd);
            await conn.with(async (data) => {
              for (let i = 0; i < 500; i++)
                data.threads["t" + i] =
                  { messages: [{ role: "assistant", content: "reply-" + i }] };
            });
            let readBack;
            await conn.with(async (data) => {
              readBack = data.threads["t0"]?.messages?.[0]?.content;
            });
            await conn.flush();
            await new Promise((r) => setTimeout(r, 3500));
            const dir = path.join(cwd, ".langgraph_api");
            let bytes = 0;
            if (fsSync.existsSync(dir))
              for (const e of fsSync.readdirSync(dir))
                bytes += fsSync.statSync(path.join(dir, e)).size;
            console.log(JSON.stringify({ readBack, bytes }));
        """)
        )

        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": os.environ.get("HOME", "/tmp"),
            "LANGGRAPH_DISABLE_FILE_PERSISTENCE": "true",
            "PERSIST_ABS": str(persist_pkg),
            "RUN_CWD": str(run_cwd),
        }
        preload = agent_dir / "disable-file-persistence.mjs"
        result = subprocess.run(
            [node, "--import", str(preload), str(driver)],
            cwd=str(agent_dir),
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, (
            f"driver failed rc={result.returncode}\n"
            f"stdout={result.stdout!r}\nstderr={result.stderr!r}"
        )
        # Last JSON line of stdout carries the result.
        payload = None
        for line in reversed(result.stdout.strip().splitlines()):
            try:
                payload = json.loads(line)
                break
            except ValueError:
                continue
        assert payload is not None, f"no JSON result. stdout={result.stdout!r}"
        assert payload["bytes"] == 0, (
            "REAL @langchain/langgraph-api persist flush grew .langgraph_api to "
            f"{payload['bytes']} bytes despite the disable flag — the fix does not "
            "cover the package's real write path."
        )
        assert payload["readBack"] == "reply-0", (
            "In-memory round-trip broke: expected 'reply-0', got "
            f"{payload['readBack']!r}. Persistence disable must not remove "
            "in-lifetime conversation state."
        )

    def test_boot_fails_if_namespace_binding_not_patched_high1(self, tmp_path):
        """HIGH-1 negative proof: if node:fs/promises is LINKED before the
        preload's property reassignments run, the ESM namespace snapshots the
        ORIGINAL (unpatched) function reference and a consumer's fs.writeFile
        would silently bypass the no-op. The preload's runtime binding-identity
        assertion MUST catch this and FAIL BOOT (non-zero exit) naming the
        affected members — never continue silently into a disk-growth outage.

        We simulate the fragile ordering with an earlier `--import` module that
        links node:fs/promises before the disable module, then assert the
        process exits non-zero with the FATAL identity-mismatch message. A
        control run (correct ordering) is covered by
        test_real_package_writes_are_suppressed_behavioral above.
        """
        import shutil

        node = shutil.which("node")
        require_behavioral = os.environ.get("LGT_REQUIRE_BEHAVIORAL") == "1"
        if node is None:
            if require_behavioral:
                pytest.fail(
                    "LGT_REQUIRE_BEHAVIORAL=1 but node is not on PATH — cannot "
                    "run the HIGH-1 guard-fires proof."
                )
            pytest.skip("node not on PATH")

        agent_dir = _PKG_ROOT / "src" / "agent"
        preload = agent_dir / "disable-file-persistence.mjs"
        assert preload.exists(), f"preload missing at {preload}"

        # Earlier-ordered --import that links node:fs/promises FIRST, forcing the
        # namespace binding to snapshot the pre-patch original.
        early = tmp_path / "early_link_fs_promises.mjs"
        early.write_text(
            dedent(
                """
                import * as _fsp from "node:fs/promises";
                void _fsp.writeFile; // force the namespace binding to resolve now
                """
            )
        )

        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": os.environ.get("HOME", "/tmp"),
            "LANGGRAPH_DISABLE_FILE_PERSISTENCE": "true",
        }
        result = subprocess.run(
            [
                node,
                "--import",
                str(early),
                "--import",
                str(preload),
                "-e",
                "console.log('SHOULD-NOT-REACH')",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        combined = result.stdout + result.stderr
        assert result.returncode != 0, (
            "Expected boot to FAIL when node:fs/promises is linked before the "
            "patch (namespace snapshots the original fn), but the process exited "
            f"0. stdout={result.stdout!r} stderr={result.stderr!r}"
        )
        assert "SHOULD-NOT-REACH" not in result.stdout, (
            "Boot continued past the identity guard despite the namespace binding "
            "NOT reflecting the patch — this is the silent-bypass failure mode."
        )
        assert "namespace binding does NOT reflect the installed patch" in combined, (
            "Expected the FATAL binding-identity message naming the unpatched "
            f"members. output={combined!r}"
        )
        assert "writeFile" in combined, (
            "The identity-guard failure must name the writeFile member (the "
            f"primary persist write surface). output={combined!r}"
        )


@pytest.mark.skipif(not _ENTRYPOINT.exists(), reason="entrypoint.sh not found")
class TestNoFixedIntervalTruncate:
    """The fixed-interval POST /internal/truncate loop must NOT exist.

    R7-C1: ops.truncate with runs+threads+checkpointer+store=true wipes ALL
    runs/threads including in-flight ones. A fixed timer is unsafe.
    C2: The endpoint exists in 1.1.17 but is an unpinned internal contract.
    """

    def test_truncate_loop_absent_from_entrypoint(self):
        """No fixed-interval truncate loop in entrypoint source."""
        source = _ENTRYPOINT.read_text()
        assert "TRUNCATE_INTERVAL" not in source, (
            "Fixed-interval TRUNCATE_INTERVAL variable found — truncate loop "
            "must be removed (R7-C1: wipes in-flight runs on a timer)"
        )

    def test_no_truncate_curl_call_in_source(self):
        """entrypoint.sh must not have an executable curl call to /internal/truncate.

        Comments may mention the route for documentation; we only ban live calls.
        A live call looks like: curl ... http://...8123/internal/truncate
        """
        import re

        source = _ENTRYPOINT.read_text()
        # Strip comment lines (lines starting with optional whitespace + #)
        non_comment_lines = [
            line for line in source.splitlines() if not line.lstrip().startswith("#")
        ]
        non_comment_source = "\n".join(non_comment_lines)
        live_call = re.search(r"curl\b.*internal/truncate", non_comment_source)
        assert live_call is None, (
            f"Live curl call to /internal/truncate found (R7-C1 + C2): "
            f"{live_call.group() if live_call else ''}"
        )

    def test_no_periodic_truncate_comment(self):
        """Old 'periodic /internal/truncate loop' comment must be gone."""
        source = _ENTRYPOINT.read_text()
        assert "periodic state truncation every" not in source, (
            "Old truncate loop comment still present — must be updated"
        )


@pytest.mark.skipif(not _ENTRYPOINT.exists(), reason="entrypoint.sh not found")
class TestSizeGatedRestart:
    """Size-gated restart mechanism: BEHAVIORAL tests via --check-size-once seam.

    These tests exercise the actual size-check-and-kill logic by running
    `entrypoint.sh --check-size-once` with a stubbed `du` returning a
    controlled value.  They are mutation-sensitive: a reversed comparison
    (-ge → -lt) or broken du|awk extraction causes test failures.
    """

    def test_gate_fires_when_over_threshold(self, tmp_path):
        """Size gate MUST kill agent (exit 1) when du reports OVER threshold.

        This test is mutation-sensitive: if the comparison is reversed
        (-ge → -lt), this test fails (gate would NOT fire over threshold).
        Also asserts the dummy agent PID was ACTUALLY killed by the gate
        (not just that the script logged "killing" — dummy.poll() must be
        non-None, proving kill -9 landed on the real PID, not a bogus one).
        """
        persist_dir = tmp_path / "langgraph_api"
        persist_dir.mkdir()

        r = _run_check_size_once(
            tmp_path,
            persist_dir=persist_dir,
            size_threshold_mb=100,
            du_size_mb=150,  # 150 MB > 100 MB threshold → should fire
        )
        output = r.result.stdout + r.result.stderr
        assert r.result.returncode == 1, (
            f"Expected exit 1 (gate fires) when du reports 150MB > 100MB threshold. "
            f"returncode={r.result.returncode}, output={output!r}"
        )
        assert "Size threshold exceeded" in output, (
            f"Expected 'Size threshold exceeded' log when over threshold. output={output!r}"
        )
        assert "killing agent" in output.lower() or "killing agent PID" in output, (
            f"Expected kill log when threshold exceeded. output={output!r}"
        )
        assert r.dummy_was_killed, (
            "Gate fired (exit 1 + kill log) but dummy agent PID was NOT actually "
            "killed — kill targeted a wrong or nonexistent PID. "
            f"output={output!r}"
        )

    def test_gate_does_not_fire_when_under_threshold(self, tmp_path):
        """Size gate must NOT fire (exit 0) when du reports UNDER threshold.

        This test is mutation-sensitive: if the comparison is reversed
        (-ge → -lt), this test fails (gate would fire under threshold).
        Also asserts the dummy agent PID was NOT killed — the process must
        still be alive after the gate runs under threshold.
        """
        persist_dir = tmp_path / "langgraph_api"
        persist_dir.mkdir()

        r = _run_check_size_once(
            tmp_path,
            persist_dir=persist_dir,
            size_threshold_mb=200,
            du_size_mb=50,  # 50 MB < 200 MB threshold → should NOT fire
        )
        output = r.result.stdout + r.result.stderr
        assert r.result.returncode == 0, (
            f"Expected exit 0 (gate does not fire) when du reports 50MB < 200MB threshold. "
            f"returncode={r.result.returncode}, output={output!r}"
        )
        assert "Size threshold exceeded" not in output, (
            f"Gate must NOT fire when under threshold. output={output!r}"
        )
        assert not r.dummy_was_killed, (
            "Gate must NOT kill the agent when under threshold, "
            "but dummy agent PID was killed. "
            f"output={output!r}"
        )

    def test_gate_fires_at_exact_threshold(self, tmp_path):
        """Size gate MUST fire when du reports exactly the threshold (>= not >).

        Also asserts the dummy agent PID was ACTUALLY killed when gate fires
        at the boundary — confirms kill -9 targeted the real PID.
        """
        persist_dir = tmp_path / "langgraph_api"
        persist_dir.mkdir()

        r = _run_check_size_once(
            tmp_path,
            persist_dir=persist_dir,
            size_threshold_mb=200,
            du_size_mb=200,  # exactly at threshold → should fire (-ge)
        )
        output = r.result.stdout + r.result.stderr
        assert r.result.returncode == 1, (
            f"Expected exit 1 (gate fires) when du reports exactly threshold (200MB >= 200MB). "
            f"returncode={r.result.returncode}, output={output!r}"
        )
        assert r.dummy_was_killed, (
            "Gate fired (exit 1) at exact threshold but dummy agent PID was NOT "
            "actually killed — kill targeted a wrong or nonexistent PID. "
            f"output={output!r}"
        )

    def test_gate_skipped_when_persist_dir_missing(self, tmp_path):
        """Size gate must skip gracefully (exit 0) when persist dir does not exist."""
        persist_dir = tmp_path / "nonexistent_langgraph_api"
        # Do NOT create it

        r = _run_check_size_once(
            tmp_path,
            persist_dir=persist_dir,
            size_threshold_mb=100,
            du_size_mb=999,  # would fire if dir existed — but it doesn't
        )
        output = r.result.stdout + r.result.stderr
        assert r.result.returncode == 0, (
            f"Expected exit 0 (skip) when persist dir missing. "
            f"returncode={r.result.returncode}, output={output!r}"
        )
        assert "does not exist" in output, (
            f"Expected 'does not exist' log when persist dir missing. output={output!r}"
        )

    def test_gate_logs_size_on_each_cycle(self, tmp_path):
        """Size gate must log current size and threshold every cycle."""
        persist_dir = tmp_path / "langgraph_api"
        persist_dir.mkdir()

        r = _run_check_size_once(
            tmp_path,
            persist_dir=persist_dir,
            size_threshold_mb=200,
            du_size_mb=75,
        )
        output = r.result.stdout + r.result.stderr
        assert "75MB" in output and "200MB" in output, (
            f"Expected size and threshold logged each cycle. output={output!r}"
        )

    def test_size_check_interval_default_is_60s(self):
        """Default SIZE_CHECK_INTERVAL must be 60s (not 300s) for tighter coverage.

        At 300s, state can exceed 512MB between checks under heavy probe fan-out
        (the original crash scenario). 60s keeps the check-to-ceiling budget safe.
        """
        source = _ENTRYPOINT.read_text()
        import re

        # Find the default assignment: SIZE_CHECK_INTERVAL=${..:-<N>}
        m = re.search(r"SIZE_CHECK_INTERVAL=\$\{[^}]+:-(\d+)\}", source)
        assert m is not None, "Expected SIZE_CHECK_INTERVAL variable with default value"
        default_val = int(m.group(1))
        assert default_val <= 60, (
            f"SIZE_CHECK_INTERVAL default must be <= 60s (got {default_val}s). "
            "At 300s, state can exceed 512MB before the next check under heavy load."
        )

    def test_size_threshold_configurable(self):
        """SIZE_THRESHOLD_MB must be configurable via env var."""
        source = _ENTRYPOINT.read_text()
        assert "LANGGRAPH_SIZE_THRESHOLD_MB" in source, (
            "Expected LANGGRAPH_SIZE_THRESHOLD_MB env override for threshold"
        )


@pytest.mark.skipif(not _ENTRYPOINT.exists(), reason="entrypoint.sh not found")
class TestSizePidOrphanGuard:
    """The size-check sub-loop PID must be captured and cleaned up on watchdog exit.

    I1/I3: SIZE_PID is assigned INSIDE the watchdog subshell ( ) & so it is
    never visible in the outer shell.  The fix: register
    `trap 'kill "$SIZE_PID" 2>/dev/null || true' EXIT` INSIDE the watchdog
    subshell right after SIZE_PID=$!, so the sub-loop is reaped on any
    watchdog exit path (normal, kill from outer cleanup, SIGTERM).

    The outer cleanup() must NOT contain a dead SIZE_PID block since it will
    never be reached.
    """

    def test_size_pid_captured_in_watchdog(self):
        """Watchdog subshell must capture the size sub-loop PID after forking it."""
        source = _ENTRYPOINT.read_text()
        assert "SIZE_PID=$!" in source, (
            "Expected SIZE_PID=$! to capture size sub-loop PID for cleanup (I1 orphan guard)"
        )

    def test_size_pid_reaped_by_in_subshell_trap(self):
        """SIZE_PID sub-loop must be reaped by an EXIT trap INSIDE the watchdog subshell.

        Source-level check of the SHIPPED mechanism: the watchdog subshell
        registers `trap _reap_watchdog_children EXIT`, and
        `_reap_watchdog_children` reaps the sub-loop via a `$BASHPID` PPID-walk
        (`_agent_descendants "$BASHPID"`) plus a belt-and-suspenders direct
        `kill "$SIZE_PID"`.  (The older `trap 'kill "$SIZE_PID"' EXIT` form is
        NO LONGER used — it survives only in an explanatory comment describing
        why the arm-then-spawn ordering was changed.)
        """
        source = _ENTRYPOINT.read_text()
        # The shipped trap installs the reaper helper (not an inline kill).
        assert "trap _reap_watchdog_children EXIT" in source, (
            "Expected `trap _reap_watchdog_children EXIT` inside the watchdog "
            "subshell (the shipped reaping mechanism)"
        )
        # The reaper helper must exist and reap by a $BASHPID PPID-walk.
        assert "_reap_watchdog_children()" in source, (
            "Expected _reap_watchdog_children() helper to be defined"
        )
        reaper_match = re.search(
            r"_reap_watchdog_children\(\)\s*\{(.*?)\n  \}", source, re.DOTALL
        )
        assert reaper_match, "Could not locate _reap_watchdog_children() body"
        reaper_body = reaper_match.group(1)
        assert '_agent_descendants "$BASHPID"' in reaper_body, (
            "Reaper must PPID-walk THIS subshell ($BASHPID) to find the sub-loop"
        )
        # Belt-and-suspenders direct kill of the captured SIZE_PID is RETAINED.
        assert 'kill "$SIZE_PID"' in reaper_body, (
            'Reaper must retain the direct `kill "$SIZE_PID"` backstop'
        )
        # The outer cleanup() must NOT contain an EXECUTABLE kill for SIZE_PID
        # (it would be dead code since SIZE_PID is never set in the outer shell).
        # Comments mentioning SIZE_PID are acceptable (they explain WHY it's absent).
        cleanup_match = re.search(r"cleanup\(\)\s*\{([^}]*)\}", source, re.DOTALL)
        if cleanup_match:
            cleanup_body = cleanup_match.group(1)
            # Strip comment lines before checking for executable SIZE_PID references.
            exec_lines = [
                line
                for line in cleanup_body.splitlines()
                if line.strip() and not line.lstrip().startswith("#")
            ]
            exec_body = "\n".join(exec_lines)
            assert "SIZE_PID" not in exec_body, (
                "cleanup() must NOT have executable references to SIZE_PID — "
                "it is a subshell-local variable and is always unset in the outer shell.  "
                "Any kill of SIZE_PID here would be dead code."
            )

    def test_reap_watchdog_children_reaps_real_sub_loop_behavioral(self, tmp_path):
        """BEHAVIORAL: the SHIPPED _reap_watchdog_children reaper actually reaps a
        forked sub-loop when its parent subshell exits.

        Rather than re-implementing the reaper in a mock (which would validate a
        copy, not the shipped code), this extracts the REAL _agent_descendants +
        _reap_watchdog_children helpers from entrypoint.sh and drives them in a
        subshell whose lifecycle mirrors the watchdog: fork a long-lived sub-loop,
        capture SIZE_PID, arm `trap _reap_watchdog_children EXIT`, then SIGTERM the
        subshell and assert the sub-loop is reaped.
        """
        import time

        source = _ENTRYPOINT.read_text()

        def _extract(func_name):
            m = re.search(
                r"^(?:  )?" + re.escape(func_name) + r"\(\)\s*\{.*?^(?:  )?\}",
                source,
                re.DOTALL | re.MULTILINE,
            )
            assert m, "Could not extract %s() from entrypoint.sh" % func_name
            return m.group(0)

        agent_descendants = _extract("_agent_descendants")
        reaper = _extract("_reap_watchdog_children")

        driver = (
            "#!/bin/bash\n"
            "set -u\n"
            + _indent(agent_descendants, 0)
            + "\n"
            + _indent(reaper, 0)
            + "\n"
            + "( while :; do sleep 30; done ) &\n"
            + "SIZE_PID=$!\n"
            + 'echo "$SIZE_PID" > "'
            + str(tmp_path)
            + '/size_pid"\n'
            + "trap _reap_watchdog_children EXIT\n"
            + "while :; do sleep 30; done\n"
        )
        script_path = tmp_path / "real_watchdog.sh"
        script_path.write_text(driver)
        script_path.chmod(0o755)

        def _alive(pid):
            try:
                os.kill(pid, 0)
                return True
            except OSError:
                return False

        watchdog = subprocess.Popen(["/bin/bash", str(script_path)])
        size_pid = None
        for _ in range(40):
            pid_file = tmp_path / "size_pid"
            if pid_file.exists() and pid_file.read_text().strip():
                size_pid = int(pid_file.read_text().strip())
                break
            time.sleep(0.05)
        assert size_pid is not None, "watchdog driver never reported SIZE_PID"
        assert _alive(size_pid), "sub-loop should be alive before watchdog exits"

        # Simulate outer cleanup() SIGTERMing the watchdog subshell.
        watchdog.terminate()
        watchdog.wait(timeout=5)

        # Bounded poll for the async reap signal to land.
        reaped = False
        for _ in range(40):
            if not _alive(size_pid):
                reaped = True
                break
            time.sleep(0.05)

        if _alive(size_pid):
            try:
                os.kill(size_pid, 9)
            except OSError:
                pass

        assert reaped, (
            "Sub-loop (PID %d) still alive after the watchdog subshell exited — "
            "the SHIPPED _reap_watchdog_children EXIT trap did NOT reap it." % size_pid
        )


@pytest.mark.skipif(not _ENTRYPOINT.exists(), reason="entrypoint.sh not found")
class TestSetECorrectness:
    """C1: set -e subshell correctness — no command substitution swallowed."""

    def test_no_bare_command_substitution_for_curl_truncate(self):
        """Curl calls must not use bare VARNAME=$(curl -fsS ...) for truncate
        under set -e without error-trapping (C1 pattern).

        The fix removes the truncate loop entirely — this test confirms it.
        If it were retained, the correct pattern would be:
          a) VARNAME=$(curl ...) || true
          b) explicit rc check with || true
        But removal is the correct fix.
        """
        source = _ENTRYPOINT.read_text()
        # Old broken pattern from C1 finding:
        bad_pattern = re.search(r"TRUNC_RESPONSE=\$\(curl\s+-fsS", source)
        assert bad_pattern is None, (
            "C1: bare TRUNC_RESPONSE=$(curl -fsS ...) found under set -e. "
            "This kills the subshell on first non-2xx. "
            "The truncate loop must be removed entirely."
        )

    def test_du_in_size_check_has_error_guard(self):
        """du call in size-check must have || true to prevent set -e kill."""
        source = _ENTRYPOINT.read_text()
        # The size-check uses du -sm ... | awk, and must guard against du failures.
        # Skip comment lines (lines whose first non-whitespace char is #).
        du_lines = [
            line
            for line in source.splitlines()
            if "du -sm" in line and not line.lstrip().startswith("#")
        ]
        assert du_lines, "Expected a 'du -sm' executable line for size measurement"
        for line in du_lines:
            assert "|| true" in line or "2>/dev/null" in line, (
                f"du line lacks error guard (|| true or 2>/dev/null): {line!r}\n"
                "Under set -e, du failure (e.g. permission error) kills the subshell"
            )
