"""Saves each conversation's working files to Cloud Storage and restores them.

The agent works on local disk; a bucket mounted as a filesystem cannot take an
install's renames. After a clone, a push and every run, the conversation is
saved as one folder per thread, `ws/<thread key>/`:

- `repo.tar.gz`: the repo with its `.git`, without `.venv`, `node_modules` and
  build output (a venv is rebuilt by reinstalling);
- `remote.tar.gz`: the local bare repo `git_push` pushes to;
- `session.db`: the harness's conversation, copied with SQLite's backup API (a
  consistent copy of a live database, with no WAL file to lose);
- `meta.json`, written last: the harness conversation id and the ids of the
  user messages already sent to it. The adapter keeps both in memory only;
  without them a restarted agent starts a blank harness conversation.

When a run arrives for a thread with no local folder, the folder is restored
first and the adapter is told the conversation id, so it resumes the saved
conversation instead of starting over.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .config import Settings
from .workspace import Workspace, workspace_key

logger = logging.getLogger(__name__)

PREFIX = "ws"
# Never saved: rebuilt by an install or a build, or caches.
_SKIP_DIRS = frozenset(
    {
        ".venv",
        "node_modules",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".tox",
        ".nox",
        "build",
        "dist",
        ".next",
        "target",
        ".gradle",
    }
)


class Store(Protocol):
    def put(self, name: str, source: Path) -> None: ...
    def put_bytes(self, name: str, data: bytes) -> None: ...
    def get(self, name: str, dest: Path) -> bool: ...
    def get_bytes(self, name: str) -> bytes | None: ...
    def delete_prefix(self, prefix: str) -> None: ...


class GcsStore:
    """A Cloud Storage bucket, through the service account (ADC)."""

    def __init__(self, bucket: str) -> None:
        # Imported here: slow, and only needed in the cloud.
        from google.cloud import storage  # type: ignore[import-untyped]

        self._bucket = storage.Client().bucket(bucket)

    def put(self, name: str, source: Path) -> None:
        self._bucket.blob(name).upload_from_filename(str(source))

    def put_bytes(self, name: str, data: bytes) -> None:
        self._bucket.blob(name).upload_from_string(data, content_type="application/json")

    def get(self, name: str, dest: Path) -> bool:
        from google.api_core.exceptions import NotFound

        try:
            self._bucket.blob(name).download_to_filename(str(dest))
        except NotFound:
            dest.unlink(missing_ok=True)
            return False
        return True

    def get_bytes(self, name: str) -> bytes | None:
        from google.api_core.exceptions import NotFound

        try:
            data: bytes = self._bucket.blob(name).download_as_bytes()
        except NotFound:
            return None
        return data

    def delete_prefix(self, prefix: str) -> None:
        for blob in self._bucket.list_blobs(prefix=prefix):
            blob.delete()


class DirStore:
    """A local folder laid out like the bucket. For tests and offline runs."""

    def __init__(self, root: Path) -> None:
        self._root = root

    def _path(self, name: str) -> Path:
        return self._root / name

    def put(self, name: str, source: Path) -> None:
        target = self._path(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)

    def put_bytes(self, name: str, data: bytes) -> None:
        target = self._path(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def get(self, name: str, dest: Path) -> bool:
        source = self._path(name)
        if not source.is_file():
            return False
        shutil.copyfile(source, dest)
        return True

    def get_bytes(self, name: str) -> bytes | None:
        source = self._path(name)
        return source.read_bytes() if source.is_file() else None

    def delete_prefix(self, prefix: str) -> None:
        shutil.rmtree(self._path(prefix), ignore_errors=True)


def open_store(url: str | None) -> Store | None:
    """`gs://bucket`, a bare bucket name, `file:///dir`, or None for off."""
    if not url:
        return None
    if url.startswith("file://"):
        return DirStore(Path(url.removeprefix("file://")))
    return GcsStore(url.removeprefix("gs://").strip("/"))


def _included(root: Path) -> Iterator[Path]:
    """Every file and link under root that is saved, without skipped folders."""
    for dirpath, dirnames, filenames in os.walk(root):
        here = Path(dirpath)
        kept = []
        for name in dirnames:
            path = here / name
            if name in _SKIP_DIRS or name.endswith(".egg-info"):
                continue
            if path.is_symlink():
                yield path  # saved as a link, never followed
                continue
            kept.append(name)
        dirnames[:] = kept
        for name in filenames:
            yield here / name


def repo_size(root: Path) -> int:
    total = 0
    for path in _included(root):
        try:
            total += path.lstat().st_size
        except OSError:
            continue
    return total


def _tar(root: Path, dest: Path, files: Iterator[Path] | None = None) -> None:
    """Archives `files` (default: everything under root) for `_untar`.

    Each entry passes the same "data" filter `_untar` extracts with, so a link
    that restore would refuse (absolute, or pointing out of root) is left out
    here instead of saving an archive that cannot be restored.
    """
    skipped: list[str] = []
    with tarfile.open(dest, "w:gz", compresslevel=6) as tar:
        for path in files if files is not None else _all(root):
            info = tar.gettarinfo(path, arcname=str(path.relative_to(root)))
            if info is None:  # a socket or other type tar cannot store
                continue
            try:
                tarfile.data_filter(info, str(root))
            except tarfile.FilterError:
                skipped.append(info.name)
                continue
            if info.isreg():
                with path.open("rb") as file:
                    tar.addfile(info, file)
            else:
                tar.addfile(info)
    if skipped:
        logger.warning(
            "Not saved, because restoring them is refused (links out of %s): %s",
            root.name,
            ", ".join(sorted(skipped)[:20]),
        )


def _all(root: Path) -> Iterator[Path]:
    for dirpath, dirnames, filenames in os.walk(root):
        for name in [*dirnames, *filenames]:
            yield Path(dirpath) / name


def _untar(archive: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tar:
        # "data" refuses absolute paths, ".." and links that leave dest.
        tar.extractall(dest, filter="data")


def backup_sqlite(source: Path, dest: Path) -> None:
    """A consistent copy of a database another process is writing."""
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    try:
        dst = sqlite3.connect(dest)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def _git_head(repo: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, timeout=10
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None


@dataclass(frozen=True)
class Conversation:
    """What the adapter holds in memory for a thread's harness conversation."""

    conversation_id: str | None
    forwarded: frozenset[str]


@dataclass
class SaveResult:
    saved_repo: bool
    repo_bytes: int
    skipped_reason: str | None = None


class Snapshots:
    """Saving and restoring conversations in the store. Blocking: call from a thread."""

    def __init__(self, store: Store, settings: Settings) -> None:
        self._store = store
        self._settings = settings

    def _workspace(self, thread_id: str) -> Workspace:
        s = self._settings
        return Workspace.for_thread(
            thread_id, root=s.workspace_root, push_root=s.push_root, venv_root=s.venv_root
        )

    @staticmethod
    def _name(key: str, file: str) -> str:
        return f"{PREFIX}/{key}/{file}"

    def save(self, thread_id: str, conversation: Conversation) -> SaveResult | None:
        ws = self._workspace(thread_id)
        if not ws.has_repo:
            return None
        key = ws.key
        size = repo_size(ws.path)
        result = SaveResult(saved_repo=False, repo_bytes=size)
        with tempfile.TemporaryDirectory(prefix="rd-save-") as tmp:
            scratch = Path(tmp)
            if size > self._settings.snapshot_max_bytes:
                result.skipped_reason = (
                    f"repo is {size / 1e6:.0f} MB, over the "
                    f"{self._settings.snapshot_max_bytes / 1e6:.0f} MB save limit"
                )
                logger.warning(
                    "Not saving the repo of thread %s to the bucket: %s",
                    thread_id,
                    result.skipped_reason,
                )
            else:
                _tar(ws.path, scratch / "repo.tar.gz", _included(ws.path))
                self._store.put(self._name(key, "repo.tar.gz"), scratch / "repo.tar.gz")
                result.saved_repo = True
            if ws.push_remote.is_dir():
                _tar(ws.push_remote, scratch / "remote.tar.gz")
                self._store.put(self._name(key, "remote.tar.gz"), scratch / "remote.tar.gz")
            conv = conversation.conversation_id
            db = self._settings.save_dir / f"{conv}.db" if conv else None
            if db is not None and db.is_file():
                backup_sqlite(db, scratch / "session.db")
                self._store.put(self._name(key, "session.db"), scratch / "session.db")
            else:
                conv = None
        meta = {
            "threadKey": key,
            "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "commit": _git_head(ws.path),
            "repoSaved": result.saved_repo,
            "repoBytes": size,
            "skippedReason": result.skipped_reason,
            "conversationId": conv,
            "forwardedPrompts": sorted(conversation.forwarded),
        }
        self._store.put_bytes(self._name(key, "meta.json"), json.dumps(meta, indent=2).encode())
        return result

    def restore(self, thread_id: str) -> Conversation | None:
        """Brings back a saved conversation whose local folder is gone.

        Returns what the adapter needs to resume it, or None when nothing was
        saved or the folder is still here.
        """
        ws = self._workspace(thread_id)
        if ws.has_repo:
            return None
        raw = self._store.get_bytes(self._name(ws.key, "meta.json"))
        if raw is None:
            return None
        meta: dict[str, Any] = json.loads(raw)
        ws.ensure()
        with tempfile.TemporaryDirectory(prefix="rd-restore-") as tmp:
            scratch = Path(tmp)
            if meta.get("repoSaved") and self._store.get(
                self._name(ws.key, "repo.tar.gz"), scratch / "repo.tar.gz"
            ):
                _untar(scratch / "repo.tar.gz", ws.path)
            if self._store.get(self._name(ws.key, "remote.tar.gz"), scratch / "remote.tar.gz"):
                _untar(scratch / "remote.tar.gz", ws.push_remote)
            conv = meta.get("conversationId")
            db = self._settings.save_dir / f"{conv}.db" if conv else None
            if db is not None and not db.exists():
                self._settings.save_dir.mkdir(parents=True, exist_ok=True)
                if self._store.get(self._name(ws.key, "session.db"), db):
                    db.chmod(0o600)  # as the harness creates it
                else:
                    conv = None
        logger.info(
            "Restored thread %s from the bucket (repo=%s, conversation=%s)",
            thread_id,
            bool(meta.get("repoSaved")),
            conv,
        )
        return Conversation(
            conversation_id=conv, forwarded=frozenset(meta.get("forwardedPrompts") or [])
        )

    def saved_conversation_id(self, thread_id: str) -> str | None:
        raw = self._store.get_bytes(self._name(workspace_key(thread_id), "meta.json"))
        if raw is None:
            return None
        conv = json.loads(raw).get("conversationId")
        return conv if isinstance(conv, str) else None

    def delete(self, thread_id: str) -> None:
        self._store.delete_prefix(f"{PREFIX}/{workspace_key(thread_id)}/")


class Snapshotter:
    """Schedules saves in the background: one at a time per thread, coalesced.

    A save asked for while one runs makes exactly one more save after it, so
    the bucket always ends with the latest state and bursts cost two saves.
    """

    def __init__(self, snapshots: Snapshots, sessions: Any) -> None:
        self._snapshots = snapshots
        self._sessions = sessions
        self._running: dict[str, asyncio.Task[None]] = {}
        self._again: set[str] = set()
        # Deleted threads: a save scheduled afterwards (a run that was still
        # ending) must not write the folder back.
        self._deleted: set[str] = set()
        self._restore_locks: dict[str, asyncio.Lock] = {}

    def conversation(self, thread_id: str) -> Conversation:
        """The adapter's in-memory record of the thread's harness conversation."""
        session = self._sessions._sessions.get(thread_id)
        if session is not None:
            conv = session.conversation_id or getattr(session.agent, "conversation_id", None)
            return Conversation(conv, frozenset(session.forwarded_prompts))
        remembered = self._sessions._remembered.get(thread_id)
        if remembered is not None:
            return Conversation(remembered[0], frozenset(remembered[1]))
        return Conversation(None, frozenset())

    def schedule(self, thread_id: str) -> None:
        if thread_id in self._deleted:
            return
        if thread_id in self._running:
            self._again.add(thread_id)
            return
        task = asyncio.get_running_loop().create_task(self._loop(thread_id))
        self._running[thread_id] = task

    async def _loop(self, thread_id: str) -> None:
        try:
            while True:
                self._again.discard(thread_id)
                conversation = self.conversation(thread_id)
                try:
                    await asyncio.to_thread(self._snapshots.save, thread_id, conversation)
                except Exception:
                    logger.exception("Saving thread %s to the bucket failed", thread_id)
                if thread_id not in self._again:
                    return
        finally:
            self._running.pop(thread_id, None)

    async def flush(self) -> None:
        """Waits for every scheduled save (tests and shutdown)."""
        while self._running:
            await asyncio.gather(*list(self._running.values()), return_exceptions=True)

    async def restore(self, thread_id: str) -> None:
        """Restores a thread before its session is built, if it needs it."""
        if thread_id in self._sessions._sessions or thread_id in self._sessions._remembered:
            return
        lock = self._restore_locks.setdefault(thread_id, asyncio.Lock())
        async with lock:
            if thread_id in self._sessions._remembered:
                return
            try:
                restored = await asyncio.to_thread(self._snapshots.restore, thread_id)
            except Exception:
                logger.exception("Restoring thread %s from the bucket failed", thread_id)
                return
            if restored is not None and restored.conversation_id:
                # What the adapter itself records when it closes a session:
                # the next session for this thread cold-resumes this conversation.
                self._sessions._remembered[thread_id] = (
                    restored.conversation_id,
                    set(restored.forwarded),
                )

    async def stop(self, thread_id: str) -> str | None:
        """Stops saving a thread that is being deleted; waits for a save in
        flight. Returns the conversation id the bucket recorded, if any."""
        self._deleted.add(thread_id)
        self._again.discard(thread_id)
        task = self._running.get(thread_id)
        if task is not None:
            await asyncio.gather(task, return_exceptions=True)
        return await asyncio.to_thread(self._snapshots.saved_conversation_id, thread_id)

    async def delete(self, thread_id: str) -> None:
        await asyncio.to_thread(self._snapshots.delete, thread_id)
