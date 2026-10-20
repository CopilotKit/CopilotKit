"""The agent can never push to GitHub or act as the user's GitHub identity."""

import io
import json
import os
import subprocess
import urllib.request
from pathlib import Path
from typing import Any

import pytest

from repo_doctor import ci, tools
from repo_doctor.config import Settings
from repo_doctor.safety import (
    BLOCKED_PUSH_URL,
    REMOVED_VARIABLES,
    harden_process_environment,
    hardened_environment,
)
from repo_doctor.shell import child_env
from repo_doctor.workspace import Workspace

USER_ENV = {
    "PATH": "/usr/bin:/bin",
    "HOME": "/home/someone",
    "GH_TOKEN": "ghp_x",
    "GITHUB_TOKEN": "ghs_x",
    "GH_ENTERPRISE_TOKEN": "x",
    "GIT_ASKPASS": "/usr/bin/askpass",
    "SSH_ASKPASS": "/usr/bin/ssh-askpass",
    "SSH_AUTH_SOCK": "/tmp/agent.sock",
    "GEMINI_API_KEY": "secret",
}


def _git(cwd: Path, *args: str, env: dict[str, str] | None = None) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True, env=env
    ).stdout.strip()


def test_tokens_keys_and_helpers_are_removed(tmp_path: Path) -> None:
    env = hardened_environment(USER_ENV, tmp_path / "gh")

    for name in REMOVED_VARIABLES:
        assert name not in env
    assert env["PATH"] == "/usr/bin:/bin"


def test_git_and_gh_cannot_find_credentials(tmp_path: Path) -> None:
    env = hardened_environment(USER_ENV, tmp_path / "gh")

    assert env["GIT_SSH_COMMAND"] == "false"
    assert env["GIT_TERMINAL_PROMPT"] == "0"
    assert env["GIT_CONFIG_NOSYSTEM"] == "1"
    assert env["GIT_CONFIG_GLOBAL"] == "/dev/null"
    assert env["GH_CONFIG_DIR"] == str(tmp_path / "gh")


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/acme/demo.git",
        "git@github.com:acme/demo.git",
        "ssh://git@github.com/acme/demo.git",
    ],
)
def test_every_push_to_github_is_rewritten_to_a_dead_host(tmp_path: Path, url: str) -> None:
    env = hardened_environment(
        USER_ENV | {"PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin"}, tmp_path / "gh"
    )
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "--quiet", env=env)
    _git(repo, "remote", "add", "gh", url, env=env)

    push_url = _git(repo, "remote", "get-url", "--push", "gh", env=env)

    assert push_url.startswith(BLOCKED_PUSH_URL)
    assert "github.com" not in push_url


@pytest.fixture
def state(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    store: dict[str, Any] = {}
    monkeypatch.setattr(tools, "experimental_get_state", lambda: dict(store))
    monkeypatch.setattr(tools, "experimental_set_state", lambda new: store.update(new))
    return store


async def test_a_clone_pushes_only_to_the_local_bare_repository(
    tmp_path: Path, state: dict[str, Any]
) -> None:
    ws = Workspace.for_thread("t", root=tmp_path / "ws", push_root=tmp_path / "remotes")
    ws.ensure()
    # What `git clone https://github.com/acme/demo.git .` leaves behind.
    _git(ws.path, "init", "--quiet", "--initial-branch=main")
    _git(
        ws.path,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "--allow-empty",
        "-qm",
        "init",
    )
    _git(ws.path, "remote", "add", "origin", "https://github.com/acme/demo.git")
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, gemini_api_key="k", workspace_root=tmp_path / "ws"
    )
    clone_repo = {fn.__name__: fn for fn in tools.build_tools(ws, settings)}["clone_repo"]

    result = await clone_repo(repo_ref="acme/demo")

    assert result["ok"] is True
    origin_push = _git(ws.path, "remote", "get-url", "--push", "origin")
    upstream_push = _git(ws.path, "remote", "get-url", "--push", "upstream")
    assert origin_push == str(ws.push_remote)
    assert "github.com" not in origin_push
    assert "github.com" not in upstream_push


def test_the_github_token_reaches_only_the_ci_reader(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """GITHUB_TOKEN is read into settings, then removed from everything a tool runs."""
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_read_only")
    monkeypatch.setenv("GEMINI_API_KEY", "mock")
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.github_token is not None
    assert settings.github_token.get_secret_value() == "ghp_read_only"

    saved = dict(os.environ)
    try:
        harden_process_environment(tmp_path / "gh")

        assert "GITHUB_TOKEN" in REMOVED_VARIABLES
        assert "GITHUB_TOKEN" not in os.environ
        assert "ghp_read_only" not in json.dumps(child_env())
    finally:
        # The hardening rewrites this process's git settings; undo it for later tests.
        os.environ.clear()
        os.environ.update(saved)
    # The settings object, which only `ci_status` reads it from, still has it.
    assert settings.github_token.get_secret_value() == "ghp_read_only"


def test_ci_reads_send_the_token_only_to_the_github_api(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[urllib.request.Request] = []

    class _Response(io.BytesIO):
        def __enter__(self) -> "_Response":
            return self

        def __exit__(self, *exc: object) -> None:
            return None

    def fake_urlopen(request: urllib.request.Request, timeout: float) -> _Response:
        seen.append(request)
        return _Response(b"{}")

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    ci._get("/repos/a/b/actions/runs", "ghp_read_only")
    ci._get("/repos/a/b/actions/runs", None)

    assert seen[0].full_url.startswith("https://api.github.com/")
    assert seen[0].get_header("Authorization") == "Bearer ghp_read_only"
    assert seen[1].get_header("Authorization") is None
