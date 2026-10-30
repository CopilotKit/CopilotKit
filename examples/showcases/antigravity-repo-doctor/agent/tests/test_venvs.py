"""The thread venv lives on local disk behind a `.venv` symlink, and goes when
the thread's session closes."""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from repo_doctor.venvs import VenvCleanupSessionManager, clear_venv_root
from repo_doctor.workspace import Workspace, workspace_key


def _workspace(tmp_path: Path, thread: str = "thread-1") -> Workspace:
    ws = Workspace.for_thread(
        thread, root=tmp_path / "ws", push_root=tmp_path / "remotes", venv_root=tmp_path / "venvs"
    )
    ws.ensure()
    return ws


def test_link_venv_points_dot_venv_at_the_thread_folder(tmp_path: Path) -> None:
    ws = _workspace(tmp_path)
    ws.link_venv()
    link = ws.path / ".venv"
    assert link.is_symlink()
    assert link.resolve() == ws.venv.resolve()
    (link / "marker").write_text("x")
    assert (ws.venv / "marker").read_text() == "x"


def test_link_venv_is_idempotent_and_recreates_a_deleted_folder(tmp_path: Path) -> None:
    ws = _workspace(tmp_path)
    ws.link_venv()
    ws.link_venv()
    ws.venv.rmdir()
    assert not (ws.path / ".venv").exists()  # dangling after cleanup
    ws.link_venv()
    assert (ws.path / ".venv").is_dir()


def test_link_venv_leaves_a_real_venv_alone(tmp_path: Path) -> None:
    ws = _workspace(tmp_path)
    (ws.path / ".venv").mkdir()
    ws.link_venv()
    assert not (ws.path / ".venv").is_symlink()


def test_link_venv_repoints_a_link_to_another_root(tmp_path: Path) -> None:
    ws = _workspace(tmp_path)
    (tmp_path / "old").mkdir()
    (ws.path / ".venv").symlink_to(tmp_path / "old")
    ws.link_venv()
    assert (ws.path / ".venv").readlink() == ws.venv


def test_clear_venv_root_removes_only_thread_folders(tmp_path: Path) -> None:
    root = tmp_path / "venvs"
    (root / workspace_key("a")).mkdir(parents=True)
    (root / ".deleting-0123456789-abcdef01").mkdir()
    (root / "keep-me").mkdir()
    (root / "notes.txt").write_text("x")
    clear_venv_root(root)
    assert sorted(p.name for p in root.iterdir()) == ["keep-me", "notes.txt"]


class _Agent:
    conversation_id = None

    async def __aexit__(self, *args: Any) -> None:
        return None


def _session(thread_id: str) -> Any:
    async def reset_stream() -> None:
        return None

    return SimpleNamespace(
        thread_id=thread_id,
        lock=asyncio.Lock(),
        closed=False,
        conversation_id=None,
        agent=_Agent(),
        forwarded_prompts=set(),
        bridge=SimpleNamespace(fail_all=lambda error: None),
        reset_stream=reset_stream,
    )


@pytest.mark.asyncio
async def test_closing_a_session_deletes_its_venv(tmp_path: Path) -> None:
    root = tmp_path / "venvs"
    venv = root / workspace_key("t1")
    (venv / "lib").mkdir(parents=True)
    other = root / workspace_key("t2")
    other.mkdir()
    manager = VenvCleanupSessionManager(venv_root=root)
    manager._sessions["t1"] = _session("t1")
    await manager.close("t1")
    await asyncio.gather(*manager._deleting)
    assert not venv.exists()
    assert other.exists()
    assert [p.name for p in root.iterdir()] == [other.name]


@pytest.mark.asyncio
async def test_a_rebuild_or_a_busy_session_keeps_its_venv(tmp_path: Path) -> None:
    root = tmp_path / "venvs"
    venv = root / workspace_key("t1")
    venv.mkdir(parents=True)
    manager = VenvCleanupSessionManager(venv_root=root)

    manager._sessions["t1"] = _session("t1")
    async with manager._lock:
        await manager._close_locked("t1", keep_conversation_id=True)
    assert venv.exists()

    busy = _session("t1")
    manager._sessions["t1"] = busy
    async with busy.lock, manager._lock:
        await manager._close_locked("t1")  # refused: a run holds the lock
    assert "t1" in manager._sessions
    assert venv.exists()
