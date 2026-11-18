"""Hard limits: no installs through run_command, no killing background tasks,
CPU-only PyTorch, and extras only through install_dependencies."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from google.antigravity.types import Step, StepStatus, StepType, ToolCall

from repo_doctor.guards import (
    BLOCKED,
    CPU_ONLY_ENV,
    INSTALL_MESSAGE,
    KILL_MESSAGE,
    cpu_only_installs,
    is_install_command,
    rejection,
)
from repo_doctor.harness_steps import DENIED_BY_HOOK, recoverable_error
from repo_doctor.project import ProjectPlan, optional_extras, plan_with_extras


@pytest.mark.parametrize(
    "command",
    [
        "pip install .[contrib]",
        "pip install torch",
        ".venv/bin/pip install transformers",
        "python -m pip install -U pip",
        "cd repo && uv pip install --python .venv -e '.[contrib,dev]'",
        "uv add httpx",
        "uv sync --all-extras",
        "npm install",
        "npm ci",
        "pnpm i",
        "yarn add left-pad",
        "poetry install",
        "apt-get install -y ffmpeg",
    ],
)
def test_installs_through_run_command_are_rejected(command: str) -> None:
    assert is_install_command(command)
    call = ToolCall(name="run_command", args={"CommandLine": command, "Cwd": "/ws"})
    assert rejection(call) == INSTALL_MESSAGE


@pytest.mark.parametrize(
    "command",
    [
        "pytest -q tests/x_test.py",
        "uv run --no-project --with tqdm==4.20.0 python -I -c 'import tqdm'",
        "pip list",
        "pip show torch",
        "git status",
    ],
)
def test_other_commands_pass(command: str) -> None:
    assert rejection(ToolCall(name="run_command", args={"CommandLine": command})) is None


@pytest.mark.parametrize("action", ["kill", "Kill", "stop"])
def test_killing_a_background_task_is_rejected(action: str) -> None:
    call = ToolCall(name="manage_task", args={"Action": action, "TaskId": "c/task-20"})
    assert rejection(call) == KILL_MESSAGE


def test_checking_a_background_task_passes() -> None:
    call = ToolCall(name="manage_task", args={"Action": "status", "TaskId": "c/task-20"})
    assert rejection(call) is None


def test_a_guard_rejection_goes_back_to_the_model_but_a_user_denial_does_not() -> None:
    call = ToolCall(name="run_command", args={"CommandLine": "pip install torch"})
    blocked = Step(
        type=StepType.TOOL_CALL,
        status=StepStatus.ERROR,
        tool_calls=[call],
        error=f"tool call {DENIED_BY_HOOK}: {INSTALL_MESSAGE}",
    )
    assert BLOCKED in INSTALL_MESSAGE
    assert recoverable_error(blocked) == "run_command"
    denied = blocked.model_copy(update={"error": f"tool call {DENIED_BY_HOOK}: no"})
    assert recoverable_error(denied) is None


def test_installs_use_cpu_torch(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in CPU_ONLY_ENV:
        monkeypatch.delenv(key, raising=False)
    cpu_only_installs()
    assert os.environ["UV_TORCH_BACKEND"] == "cpu"
    assert os.environ["PIP_EXTRA_INDEX_URL"] == "https://download.pytorch.org/whl/cpu"


PLAN = ProjectPlan(
    language="python",
    runner="pytest",
    install_steps=(
        ("uv", "venv", ".venv", "--quiet", "--allow-existing", "--python", "3.13"),
        ("uv", "pip", "install", "--python", ".venv", "--quiet", "-e", ".", "pytest"),
    ),
    test_args=(".venv/bin/python", "-m", "pytest"),
)


def test_declared_extras_can_be_added_to_the_install_command(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname='x'\n[project.optional-dependencies]\ncontrib=['a']\ndev=['torch']\n"
    )
    declared = optional_extras(tmp_path)
    assert declared == ["contrib", "dev"]
    command = PLAN.install_command.replace("-e .", "-e .[contrib,dev]")
    extended = plan_with_extras(PLAN, command, declared)
    assert isinstance(extended, ProjectPlan)
    assert extended.install_command == command
    assert "-e .[contrib,dev]" in extended.install_command


def test_undeclared_extras_or_other_changes_are_refused() -> None:
    declared = ["contrib", "dev"]
    bad_extra = PLAN.install_command.replace("-e .", "-e .[gpu]")
    assert "not an extra" in str(plan_with_extras(PLAN, bad_extra, declared))
    other = PLAN.install_command.replace("-e .", "-e .[dev]") + " torch"
    assert str(plan_with_extras(PLAN, other, declared)).startswith("Refused")
