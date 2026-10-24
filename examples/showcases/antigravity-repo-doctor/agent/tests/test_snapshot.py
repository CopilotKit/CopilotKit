"""Saving a conversation to the bucket and bringing it back after a restart."""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from repo_doctor.config import Settings
from repo_doctor.snapshot import (
    Conversation,
    DirStore,
    Snapshots,
    Snapshotter,
    open_store,
    repo_size,
)
from repo_doctor.uvcache import CacheGuard, dir_size
from repo_doctor.workspace import Workspace

THREAD = "thread-1"
CONV = "0123456789abcdef0123456789abcdef"


def _settings(tmp_path: Path, **extra: Any) -> Settings:
    return Settings(
        gemini_api_key="x",  # type: ignore[arg-type]
        workspace_root=tmp_path / "local" / "ws",
        save_dir=tmp_path / "local" / "sessions",
        push_root=tmp_path / "local" / "remotes",
        venv_root=tmp_path / "local" / "venvs",
        **extra,
    )


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _workspace(settings: Settings) -> Workspace:
    ws = Workspace.for_thread(
        THREAD,
        root=settings.workspace_root,
        push_root=settings.push_root,
        venv_root=settings.venv_root,
    )
    ws.ensure()
    _git(ws.path, "init", "-q")
    (ws.path / "pyproject.toml").write_text("[project]\nname = 'x'\n")
    (ws.path / "src").mkdir()
    (ws.path / "src" / "app.py").write_text("print('fixed')\n")
    _git(ws.path, "add", ".")
    _git(ws.path, "commit", "-qm", "init")
    _git(ws.path, "init", "-q", "--bare", str(ws.push_remote))
    _git(ws.path, "push", "-q", str(ws.push_remote), "HEAD:refs/heads/fix/x")
    # Never saved: rebuilt by installs and builds.
    ws.link_venv()
    (ws.venv / "big.bin").write_bytes(b"x" * 1000)
    (ws.path / "node_modules" / "pkg").mkdir(parents=True)
    (ws.path / "node_modules" / "pkg" / "index.js").write_text("x")
    (ws.path / "src" / "__pycache__").mkdir()
    (ws.path / "src" / "__pycache__" / "app.pyc").write_text("x")
    (ws.path / "x.egg-info").mkdir()
    (ws.path / "x.egg-info" / "PKG-INFO").write_text("x")
    return ws


def _session_db(settings: Settings) -> sqlite3.Connection:
    """A live harness database in WAL mode with an uncheckpointed write."""
    settings.save_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(settings.save_dir / f"{CONV}.db")
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA wal_autocheckpoint=0")
    db.execute("CREATE TABLE steps (id INTEGER PRIMARY KEY, text TEXT)")
    db.execute("INSERT INTO steps (text) VALUES ('remember PELICAN')")
    db.commit()
    return db  # left open: the WAL is not merged into the main file


def _restart(settings: Settings) -> None:
    """What a new container sees: nothing on local disk."""
    import shutil

    shutil.rmtree(settings.workspace_root.parent)


def test_round_trip_restores_repo_remote_and_session(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    store = DirStore(tmp_path / "bucket")
    snaps = Snapshots(store, settings)
    ws = _workspace(settings)
    head = _git(ws.path, "rev-parse", "HEAD")
    db = _session_db(settings)

    result = snaps.save(THREAD, Conversation(CONV, frozenset({"m1", "m2"})))
    assert result is not None and result.saved_repo
    db.close()

    folder = tmp_path / "bucket" / "ws" / ws.key
    assert sorted(p.name for p in folder.iterdir()) == [
        "meta.json",
        "remote.tar.gz",
        "repo.tar.gz",
        "session.db",
    ]
    meta = json.loads((folder / "meta.json").read_text())
    assert meta["conversationId"] == CONV
    assert meta["forwardedPrompts"] == ["m1", "m2"]
    assert meta["commit"] == head

    _restart(settings)
    restored = snaps.restore(THREAD)
    assert restored == Conversation(CONV, frozenset({"m1", "m2"}))
    # The repo, with history and the edit.
    assert (ws.path / "src" / "app.py").read_text() == "print('fixed')\n"
    assert _git(ws.path, "rev-parse", "HEAD") == head
    # Not saved.
    for skipped in (".venv", "node_modules", "src/__pycache__", "x.egg-info"):
        assert not (ws.path / skipped).exists(), skipped
    # The pushed branch.
    assert _git(ws.push_remote, "branch", "--list", "fix/x").endswith("fix/x")
    # The session, including the write that was still in the WAL.
    rows = (
        sqlite3.connect(settings.save_dir / f"{CONV}.db")
        .execute("SELECT text FROM steps")
        .fetchall()
    )
    assert rows == [("remember PELICAN",)]


def test_restore_does_nothing_when_the_folder_is_still_here(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    snaps = Snapshots(DirStore(tmp_path / "bucket"), settings)
    _workspace(settings)
    snaps.save(THREAD, Conversation(None, frozenset()))
    assert snaps.restore(THREAD) is None


def test_restore_without_a_save_returns_none(tmp_path: Path) -> None:
    snaps = Snapshots(DirStore(tmp_path / "bucket"), _settings(tmp_path))
    assert snaps.restore(THREAD) is None


def test_a_repo_over_the_cap_is_not_saved_and_warns(tmp_path: Path, caplog: Any) -> None:
    settings = _settings(tmp_path, snapshot_max_bytes=10)
    snaps = Snapshots(DirStore(tmp_path / "bucket"), settings)
    ws = _workspace(settings)
    with caplog.at_level(logging.WARNING):
        result = snaps.save(THREAD, Conversation(None, frozenset()))
    assert result is not None and not result.saved_repo
    assert "over the" in (result.skipped_reason or "")
    assert any("Not saving the repo" in r.message for r in caplog.records)
    folder = tmp_path / "bucket" / "ws" / ws.key
    assert not (folder / "repo.tar.gz").exists()
    assert json.loads((folder / "meta.json").read_text())["repoSaved"] is False


def test_repo_size_leaves_out_what_is_not_saved(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = _workspace(settings)
    size = repo_size(ws.path)
    (ws.venv / "huge.bin").write_bytes(b"x" * 1_000_000)
    assert repo_size(ws.path) == size


def test_delete_removes_the_threads_folder_only(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    snaps = Snapshots(DirStore(tmp_path / "bucket"), settings)
    ws = _workspace(settings)
    snaps.save(THREAD, Conversation(None, frozenset()))
    other = tmp_path / "bucket" / "ws" / "aaaaaaaaaa"
    other.mkdir(parents=True)
    snaps.delete(THREAD)
    assert not (tmp_path / "bucket" / "ws" / ws.key).exists()
    assert other.exists()


def test_open_store() -> None:
    assert open_store(None) is None
    assert open_store("") is None
    assert isinstance(open_store("file:///tmp/x"), DirStore)


def _sessions() -> Any:
    return SimpleNamespace(_sessions={}, _remembered={})


@pytest.mark.asyncio
async def test_saves_are_coalesced_per_thread(tmp_path: Path) -> None:
    calls: list[str] = []

    class CountingSnapshots:
        def save(self, thread_id: str, conversation: Conversation) -> None:
            calls.append(thread_id)

    snapshotter = Snapshotter(CountingSnapshots(), _sessions())  # type: ignore[arg-type]
    for _ in range(5):
        snapshotter.schedule(THREAD)
    await snapshotter.flush()
    # Asked before the first save started: that one save covers them all.
    assert calls == [THREAD]


@pytest.mark.asyncio
async def test_restore_tells_the_adapter_which_conversation_to_resume(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    snaps = Snapshots(DirStore(tmp_path / "bucket"), settings)
    _workspace(settings)
    _session_db(settings).close()
    snaps.save(THREAD, Conversation(CONV, frozenset({"m1"})))
    _restart(settings)

    sessions = _sessions()
    await Snapshotter(snaps, sessions).restore(THREAD)
    assert sessions._remembered[THREAD] == (CONV, {"m1"})


@pytest.mark.asyncio
async def test_restore_skips_a_live_or_remembered_thread(tmp_path: Path) -> None:
    class Never:
        def restore(self, thread_id: str) -> None:
            raise AssertionError("must not restore")

    sessions = _sessions()
    sessions._remembered[THREAD] = ("c", set())
    await Snapshotter(Never(), sessions).restore(THREAD)  # type: ignore[arg-type]


def test_dir_size_counts_hard_links_once(tmp_path: Path) -> None:
    (tmp_path / "a").write_bytes(b"x" * 100)
    (tmp_path / "b").hardlink_to(tmp_path / "a")
    assert dir_size(tmp_path) == 100


@pytest.mark.asyncio
async def test_cache_is_not_cleared_during_an_install(monkeypatch: Any, tmp_path: Path) -> None:
    import repo_doctor.uvcache as uvcache

    (tmp_path / "f").write_bytes(b"x" * 100)
    cleaned: list[str] = []
    monkeypatch.setattr(uvcache, "cache_dir", lambda: tmp_path)
    monkeypatch.setattr(
        uvcache,
        "_uv",
        lambda *args, **kw: (
            cleaned.append(" ".join(args)) or SimpleNamespace(returncode=0, stderr="")
        ),
    )
    guard = CacheGuard(max_bytes=10)
    guard.install_started()
    guard.install_started()
    await guard.install_finished()  # one install still running
    await guard.enforce()
    assert cleaned == []
    await guard.install_finished()
    await asyncio.gather(*guard._checks)
    assert cleaned == ["cache clean"]
