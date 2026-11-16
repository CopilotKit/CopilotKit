"""Keeps uv's package cache in check.

The agent gives uv its own cache folder (`UV_CACHE_DIR`, set at startup from
the `UV_CACHE_DIR` setting), so this never touches a developer's own cache.
Every install fills it, which on Cloud Run lives in memory. The cache
is pruned at startup and cleared when it grows past `UV_CACHE_MAX_BYTES`.
Clearing is safe for installed venvs: their files are hard links (or copies),
so they keep their data when the cache's entries go. It is never cleared while
an install is running.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
from pathlib import Path

from .shell import child_env

logger = logging.getLogger(__name__)


def _uv(*args: str, timeout: float = 300) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["uv", *args], capture_output=True, text=True, timeout=timeout, env=child_env()
    )


def cache_dir() -> Path | None:
    try:
        out = _uv("cache", "dir", timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    path = out.stdout.strip()
    return Path(path) if out.returncode == 0 and path else None


def dir_size(root: Path) -> int:
    """Bytes under root, each file counted once even when hard-linked."""
    seen: set[tuple[int, int]] = set()
    total = 0
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            try:
                st = os.lstat(os.path.join(dirpath, name))
            except OSError:
                continue
            if (st.st_dev, st.st_ino) in seen:
                continue
            seen.add((st.st_dev, st.st_ino))
            total += st.st_size
    return total


def prune() -> None:
    """Removes cache entries nothing uses. Run at startup."""
    try:
        out = _uv("cache", "prune")
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("uv cache prune failed: %s", exc)
        return
    if out.returncode != 0:
        logger.warning("uv cache prune failed: %s", out.stderr.strip()[-300:])


class CacheGuard:
    """Clears the cache past a size limit, between installs only."""

    def __init__(self, max_bytes: int) -> None:
        self._max_bytes = max_bytes
        self._installs = 0
        self._lock = asyncio.Lock()
        self._checks: set[asyncio.Task[None]] = set()

    def install_started(self) -> None:
        self._installs += 1

    async def install_finished(self) -> None:
        """Checks the size in the background, so the install result is not held up."""
        self._installs = max(0, self._installs - 1)
        if self._installs == 0:
            task = asyncio.get_running_loop().create_task(self.enforce())
            self._checks.add(task)
            task.add_done_callback(self._checks.discard)

    async def enforce(self) -> None:
        async with self._lock:
            root = await asyncio.to_thread(cache_dir)
            if root is None or not root.is_dir():
                return
            size = await asyncio.to_thread(dir_size, root)
            if size <= self._max_bytes or self._installs:
                return
            logger.warning(
                "uv cache is %.1f GB, over the %.1f GB limit; clearing it",
                size / 1e9,
                self._max_bytes / 1e9,
            )
            result = await asyncio.to_thread(_uv, "cache", "clean")
            if result.returncode != 0:
                logger.warning("uv cache clean failed: %s", result.stderr.strip()[-300:])
