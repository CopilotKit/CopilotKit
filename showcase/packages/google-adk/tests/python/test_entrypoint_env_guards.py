"""Subprocess tests for entrypoint.sh environment-variable guards.

We exercise only the GOOGLE_API_KEY branch at the top of the script. To avoid
actually starting uvicorn / next, we short-circuit the shell by arranging for
the script to exit before reaching the background-process section:

- When REQUIRE_GOOGLE_API_KEY=1 and GOOGLE_API_KEY is empty, the script must
  exit 1 IMMEDIATELY, before starting any subprocess. We assert exit=1 and
  the FATAL message on stderr.
- When REQUIRE_GOOGLE_API_KEY is unset / 0 and GOOGLE_API_KEY is empty, the
  script must WARN and continue. We can't let it continue (it would try to
  launch the full stack), so we intercept by stubbing `python` and `npx` via
  a prepended PATH so they exit 0 immediately — the script then runs `wait
  -n` on already-exited children and exits 0 with the WARN message logged.

This package is Gemini end-to-end (primary LlmAgent + generate_a2ui both use
google.genai), so the entrypoint guard was migrated from OPENAI_API_KEY to
GOOGLE_API_KEY.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest


_PKG_ROOT = Path(__file__).resolve().parents[2]
_ENTRYPOINT = _PKG_ROOT / "entrypoint.sh"


def _run_entrypoint(
    env: dict[str, str] | None = None,
    *,
    stub_subprocesses: bool = False,
    tmp_path: Path | None = None,
) -> subprocess.CompletedProcess:
    """Run entrypoint.sh in a subprocess with a controlled environment.

    When `stub_subprocesses=True`, we prepend `tmp_path` to PATH with stub
    `python` and `npx` scripts that `exit 0` immediately, so the entrypoint's
    background children terminate instantly and we can observe the full
    flow without actually launching uvicorn / Next.
    """
    clean_env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/tmp"),
    }
    if env:
        clean_env.update(env)

    if stub_subprocesses:
        assert tmp_path is not None, "tmp_path required when stub_subprocesses=True"
        stub_dir = tmp_path / "stubs"
        stub_dir.mkdir(exist_ok=True)
        for name in ("python", "npx"):
            stub = stub_dir / name
            stub.write_text("#!/bin/sh\nexit 0\n")
            stub.chmod(0o755)
        clean_env["PATH"] = f"{stub_dir}:{clean_env['PATH']}"

    return subprocess.run(
        ["/bin/bash", str(_ENTRYPOINT)],
        env=clean_env,
        capture_output=True,
        text=True,
        timeout=15,
    )


@pytest.mark.skipif(not _ENTRYPOINT.exists(), reason="entrypoint.sh not found")
def test_require_google_api_key_fails_fast_when_missing():
    """REQUIRE_GOOGLE_API_KEY=1 + missing GOOGLE_API_KEY → exit 1, FATAL log."""
    result = _run_entrypoint(
        env={"REQUIRE_GOOGLE_API_KEY": "1"},
    )
    assert result.returncode == 1, (
        f"expected exit 1, got {result.returncode}. stderr={result.stderr!r}"
    )
    assert "FATAL" in result.stderr
    assert "GOOGLE_API_KEY not set" in result.stderr
    assert "REQUIRE_GOOGLE_API_KEY=1" in result.stderr


@pytest.mark.skipif(not _ENTRYPOINT.exists(), reason="entrypoint.sh not found")
def test_default_missing_key_warns_but_does_not_fail_fast(tmp_path):
    """Without REQUIRE_GOOGLE_API_KEY, missing key only WARNs — script
    continues past the guard. With stubbed python/npx, the entrypoint
    completes and exits 0 (both children exited cleanly)."""
    result = _run_entrypoint(
        env={},  # no REQUIRE_GOOGLE_API_KEY, no GOOGLE_API_KEY
        stub_subprocesses=True,
        tmp_path=tmp_path,
    )
    # Script must NOT fail fast on the guard. It continues; both stubbed
    # children exit 0 so the overall script exits 0.
    assert "FATAL" not in result.stderr, (
        f"unexpected fail-fast when REQUIRE_GOOGLE_API_KEY is unset: {result.stderr!r}"
    )
    assert "WARN: GOOGLE_API_KEY not set" in result.stderr


@pytest.mark.skipif(not _ENTRYPOINT.exists(), reason="entrypoint.sh not found")
def test_require_google_api_key_zero_also_warns(tmp_path):
    """REQUIRE_GOOGLE_API_KEY=0 is equivalent to unset — WARN only."""
    result = _run_entrypoint(
        env={"REQUIRE_GOOGLE_API_KEY": "0"},
        stub_subprocesses=True,
        tmp_path=tmp_path,
    )
    assert "FATAL" not in result.stderr
    assert "WARN: GOOGLE_API_KEY not set" in result.stderr


@pytest.mark.skipif(not _ENTRYPOINT.exists(), reason="entrypoint.sh not found")
def test_present_key_does_not_warn_or_fail(tmp_path):
    """GOOGLE_API_KEY present → no WARN, no FATAL, regardless of REQUIRE flag."""
    result = _run_entrypoint(
        env={"GOOGLE_API_KEY": "test-dummy", "REQUIRE_GOOGLE_API_KEY": "1"},
        stub_subprocesses=True,
        tmp_path=tmp_path,
    )
    assert "FATAL" not in result.stderr
    assert "WARN: GOOGLE_API_KEY not set" not in result.stderr
