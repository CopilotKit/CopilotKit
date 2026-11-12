"""One workspace folder per conversation thread.

Every AG-UI thread gets its own directory, derived from the thread id. The
Antigravity harness is confined to it (`workspaces=[...]`), and the repo tools
bound to that thread only ever touch it. A short hash keeps the path short,
which matters: the model copies absolute paths into tool calls.

A Python repo's `.venv` is a symlink to a folder under a separate root on
local disk. The repo can then live on a Cloud Storage volume while the
thousands of small files an install writes stay off it.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path


def workspace_key(thread_id: str) -> str:
    """A short, stable, filesystem-safe key for a thread id."""
    return hashlib.sha256(thread_id.encode("utf-8")).hexdigest()[:10]


@dataclass(frozen=True)
class Workspace:
    """Where one thread's repo lives, and where its pushes go."""

    key: str
    path: Path
    push_remote: Path
    venv: Path

    @classmethod
    def for_thread(
        cls, thread_id: str, *, root: Path, push_root: Path, venv_root: Path | None = None
    ) -> Workspace:
        key = workspace_key(thread_id)
        venvs = venv_root if venv_root is not None else root.parent / "venvs"
        return cls(key=key, path=root / key, push_remote=push_root / f"{key}.git", venv=venvs / key)

    def ensure(self) -> None:
        self.path.mkdir(parents=True, exist_ok=True)
        self.push_remote.parent.mkdir(parents=True, exist_ok=True)

    def link_venv(self) -> None:
        """Points the repo's `.venv` at this thread's venv folder.

        Recreates the folder when it was deleted with a closed session, so a
        returning thread reinstalls into the same place. A real `.venv`
        directory (from before venvs moved) is left as it is.
        """
        link = self.path / ".venv"
        self.venv.mkdir(parents=True, exist_ok=True)
        if link.is_symlink():
            if link.readlink() == self.venv:
                return
            link.unlink()
        elif link.exists():
            return
        link.symlink_to(self.venv, target_is_directory=True)

    @property
    def has_repo(self) -> bool:
        return (self.path / ".git").is_dir()
