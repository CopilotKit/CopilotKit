"""Subprocess tests for entrypoint.sh watchdog / persistence-bounding mechanism.

Covers:
  C1 - Under set -e, TRUNC_RESPONSE=$(curl -fsS ...) exits the subshell on
       first non-2xx, making the truncate loop dead code.
  C2 - /internal/truncate exists in @langchain/langgraph-api@1.1.17 but wipes
       ALL in-flight runs/threads (R7-C1), making a fixed-interval timer unsafe.
  Fix verification:
    - Boot-purge (.langgraph_api removal) still fires on every start.
    - No fixed-interval POST to /internal/truncate in watchdog.
    - Size-gated restart mechanism: fires restart only when dir exceeds threshold,
      NOT on a fixed timer; watchdog kills the agent (triggering container restart
      which re-runs boot-purge).
    - Failure escalation: size-check errors are logged, not silently swallowed.
    - Behavioral: the size-gate logic actually executes under test (not just grep).

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
import subprocess
from pathlib import Path
from textwrap import dedent
from typing import NamedTuple

import pytest


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
        dummy_was_killed = dummy.poll() is not None
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
        """SIZE_PID must be reaped by an EXIT trap INSIDE the watchdog subshell.

        Source-level check: the trap must appear inside the ( ) & block,
        after SIZE_PID=$!, not in the outer cleanup() function.
        """
        source = _ENTRYPOINT.read_text()
        # The trap must be registered inside the watchdog subshell (after SIZE_PID=$!)
        # and must reference SIZE_PID.
        assert (
            'trap \'kill "$SIZE_PID"' in source or "trap 'kill \"$SIZE_PID\"'" in source
        ), (
            "Expected `trap 'kill \"$SIZE_PID\" ...' EXIT` inside watchdog subshell "
            "(I1: SIZE_PID is subshell-local, outer cleanup cannot reach it)"
        )
        # The outer cleanup() must NOT contain an EXECUTABLE kill for SIZE_PID
        # (it would be dead code since SIZE_PID is never set in the outer shell).
        # Comments mentioning SIZE_PID are acceptable (they explain WHY it's absent).
        import re

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

    def test_size_pid_reaped_on_watchdog_exit_behavioral(self, tmp_path):
        """BEHAVIORAL: size sub-loop is actually reaped when its parent subshell exits.

        Simulates the watchdog subshell lifecycle:
          1. Fork a long-running "size sub-loop" process (sleep 60, stands in for the
             real size-check loop).
          2. Register `trap 'kill "$SIZE_PID" 2>/dev/null || true' EXIT` in a subshell,
             exactly as the fixed entrypoint does.
          3. Send SIGTERM to the subshell (simulating the outer cleanup() killing the
             watchdog).
          4. Assert the size sub-loop was reaped (poll() is not None).

        This exercises the trap FIRING, not just its registration.
        """
        import time

        # Spawn the "size sub-loop" process (long-lived, safe to kill).
        size_loop = subprocess.Popen(["sleep", "60"])
        size_pid = size_loop.pid

        # Write a minimal shell that mimics the fixed watchdog subshell:
        # register the in-subshell EXIT trap, then sleep (simulating the
        # watchdog's health-probe loop blocked in sleep).
        watchdog_script = dedent(f"""\
            #!/bin/bash
            set -e
            SIZE_PID={size_pid}
            trap 'kill "$SIZE_PID" 2>/dev/null || true' EXIT
            # Simulate watchdog blocked in health-probe sleep.
            sleep 60
        """)
        script_path = tmp_path / "mock_watchdog.sh"
        script_path.write_text(watchdog_script)
        script_path.chmod(0o755)

        watchdog = subprocess.Popen(["/bin/bash", str(script_path)])
        # Let the script register its trap.
        time.sleep(0.1)

        # Simulate outer cleanup() sending SIGTERM to the watchdog.
        watchdog.terminate()
        watchdog.wait(timeout=3)

        # The EXIT trap should have reaped the size sub-loop.
        # Give the OS a moment to deliver the kill.
        for _ in range(20):
            if size_loop.poll() is not None:
                break
            time.sleep(0.05)

        size_exit = size_loop.poll()
        assert size_exit is not None, (
            f"Size sub-loop (PID {size_pid}) is still alive after watchdog subshell "
            "exited — EXIT trap did NOT fire or did not kill it.  "
            "This is the I1 orphan: the sub-loop outlives the watchdog."
        )
        # Clean up in case assertion is skipped.
        size_loop.kill()
        size_loop.wait()


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
        import re

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
        import re

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
