"""entrypoint.sh refuses to start without a Gemini API key.

The Go harness will not create a conversation without one, even against
aimock, so without it the server comes up healthy and every run fails. The
guard must exit before launching any process; with a key set the script must
get past it.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

_ENTRYPOINT = Path(__file__).resolve().parents[2] / "entrypoint.sh"


def _run(env, tmp_path):
    # Stub python / npx so a run that gets past the guard exits at once
    # instead of launching uvicorn and Next.
    for name in ("python", "npx", "node"):
        stub = tmp_path / name
        stub.write_text("#!/bin/sh\nexit 0\n")
        stub.chmod(0o755)
    full_env = {
        "PATH": f"{tmp_path}:{os.environ.get('PATH', '/usr/bin:/bin')}",
        "HOME": str(tmp_path),
        **env,
    }
    return subprocess.run(
        ["bash", str(_ENTRYPOINT)],
        env=full_env,
        capture_output=True,
        text=True,
        timeout=60,
        cwd=tmp_path,
    )


def test_missing_credentials_are_fatal_before_anything_starts(tmp_path):
    result = _run({}, tmp_path)
    assert result.returncode == 1
    assert "FATAL: set GEMINI_API_KEY" in result.stderr
    assert "Starting Python agent" not in result.stdout


def test_a_base_url_alone_is_not_enough(tmp_path):
    result = _run({"GOOGLE_GEMINI_BASE_URL": "http://aimock:4010"}, tmp_path)
    assert result.returncode == 1
    assert "FATAL: set GEMINI_API_KEY" in result.stderr


@pytest.mark.parametrize("env", [{"GEMINI_API_KEY": "k"}, {"GOOGLE_API_KEY": "k"}])
def test_a_key_gets_past_the_guard(tmp_path, env):
    result = _run(env, tmp_path)
    assert "FATAL" not in result.stderr
    assert "Starting Python agent" in result.stdout
