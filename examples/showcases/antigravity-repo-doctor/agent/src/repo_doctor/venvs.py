"""Deletes a thread's Python venv when its Antigravity session closes.

Venvs live on local disk (`VENV_ROOT`, see workspace.py), which on Cloud Run is
memory. A genai-processors venv is about 1.2 GB, so keeping every thread's venv
for the whole day would fill the instance. A thread that comes back after its
session closed reinstalls (its repo is still there).
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

from ag_ui_antigravity import SessionManager

from .workspace import workspace_key

logger = logging.getLogger(__name__)


# Only folders this module creates: a thread key, or one being deleted.
_OURS = re.compile(r"(?:[0-9a-f]{10}|\.deleting-[0-9a-f]{10}-[0-9a-f]{8})")


def clear_venv_root(venv_root: Path) -> None:
    """Removes every thread venv. Run at startup, when no session is live."""
    venv_root.mkdir(parents=True, exist_ok=True)
    for child in venv_root.iterdir():
        if _OURS.fullmatch(child.name) and child.is_dir() and not child.is_symlink():
            shutil.rmtree(child, ignore_errors=True)


class VenvCleanupSessionManager(SessionManager):  # type: ignore[misc]
    """The adapter's session manager, plus venv removal on close.

    Overrides the private `_close_locked` (ag-ui-antigravity 0.2.1, pinned),
    which every close goes through: idle sweeps, explicit closes, shutdown.
    """

    def __init__(self, *, venv_root: Path, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._venv_root = venv_root
        self._deleting: set[asyncio.Task[None]] = set()

    async def _close_locked(
        self, thread_id: str, *, keep_conversation_id: bool = False, force: bool = False
    ) -> tuple[Any, ...]:
        was_live = thread_id in self._sessions
        result: tuple[Any, ...] = await super()._close_locked(
            thread_id, keep_conversation_id=keep_conversation_id, force=force
        )
        # keep_conversation_id: the session is being rebuilt right away (its
        # tool set changed), so the venv is still needed. A close refused
        # because a run is in flight leaves the session live.
        if was_live and thread_id not in self._sessions and not keep_conversation_id:
            self._delete_venv(thread_id)
        return result

    def _delete_venv(self, thread_id: str) -> None:
        venv = self._venv_root / workspace_key(thread_id)
        if not venv.is_dir():
            return
        # Renamed first (instant, under the manager lock), so a thread that
        # returns at once gets a fresh folder; the slow delete runs off-loop.
        trash = self._venv_root / f".deleting-{venv.name}-{uuid.uuid4().hex[:8]}"
        try:
            os.rename(venv, trash)
        except OSError:
            logger.exception("Could not remove the venv of thread %s", thread_id)
            return
        task = asyncio.get_running_loop().create_task(asyncio.to_thread(shutil.rmtree, trash, True))
        self._deleting.add(task)
        task.add_done_callback(self._deleting.discard)
        logger.info("Removed the venv of thread %s (session closed)", thread_id)
