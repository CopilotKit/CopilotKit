"""Runs subprocesses for the tools without blocking the event loop.

Commands run code from a repository the agent just cloned, so they get a
minimal environment (no API keys) and their whole process group is killed on
timeout or cancellation. Output is read as a stream and capped, so a noisy
test suite cannot exhaust memory.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

# Enough for a failure summary; the model never needs megabytes of log.
MAX_OUTPUT_CHARS = 60_000
_HEAD_CHARS = MAX_OUTPUT_CHARS // 4
_READ_CHUNK = 64 * 1024

# Variables a build or test run legitimately needs. Everything else, including
# GEMINI_API_KEY, stays out of the child's environment.
_ENV_NAMES = {
    "PATH",
    "HOME",
    "USER",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TERM",
    "SHELL",
    "GH_CONFIG_DIR",
    "GH_PROMPT_DISABLED",
}
_ENV_PREFIXES = ("UV_", "PIP_", "NPM_CONFIG_", "npm_config_", "COREPACK_", "GIT_")


def child_env() -> dict[str, str]:
    env = {
        name: value
        for name, value in os.environ.items()
        if name in _ENV_NAMES or name.startswith(_ENV_PREFIXES)
    }
    env.setdefault("PATH", "/usr/local/bin:/usr/bin:/bin")
    return env


@dataclass(frozen=True)
class CommandResult:
    command: str
    exit_code: int
    output: str
    duration_seconds: float
    timed_out: bool = False

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.timed_out


class _CappedBuffer:
    """Keeps the first and last part of a stream, dropping the middle."""

    def __init__(self) -> None:
        self._head = ""
        self._tail = ""
        self._dropped = 0

    def add(self, text: str) -> None:
        if len(self._head) < _HEAD_CHARS:
            room = _HEAD_CHARS - len(self._head)
            self._head += text[:room]
            text = text[room:]
        self._tail += text
        overflow = len(self._tail) - (MAX_OUTPUT_CHARS - _HEAD_CHARS)
        if overflow > 0:
            self._tail = self._tail[overflow:]
            self._dropped += overflow

    def text(self) -> str:
        if not self._dropped:
            return self._head + self._tail
        return f"{self._head}\n... [{self._dropped} characters cut] ...\n{self._tail}"


def _kill_group(proc: asyncio.subprocess.Process) -> None:
    with contextlib.suppress(ProcessLookupError):
        os.killpg(proc.pid, signal.SIGKILL)


async def run(
    args: Sequence[str],
    *,
    cwd: Path,
    timeout: float,
    env: Mapping[str, str] | None = None,
) -> CommandResult:
    """Runs `args` (no shell) and returns combined stdout and stderr.

    `env` adds or overrides variables on top of the minimal `child_env()`.
    """
    started = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        *args,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env={**child_env(), **(env or {})},
        start_new_session=True,
    )
    assert proc.stdout is not None
    buffer = _CappedBuffer()

    async def drain() -> None:
        assert proc.stdout is not None
        while chunk := await proc.stdout.read(_READ_CHUNK):
            buffer.add(chunk.decode("utf-8", errors="replace"))
        await proc.wait()

    timed_out = False
    try:
        await asyncio.wait_for(drain(), timeout=timeout)
    except TimeoutError:
        timed_out = True
        _kill_group(proc)
        await proc.wait()
    except asyncio.CancelledError:
        _kill_group(proc)
        raise
    return CommandResult(
        command=" ".join(args),
        exit_code=proc.returncode if proc.returncode is not None else -1,
        output=buffer.text(),
        duration_seconds=round(time.monotonic() - started, 2),
        timed_out=timed_out,
    )
