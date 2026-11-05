"""Hard limits on what the model may do, enforced before a tool runs.

Prompt rules did not hold on real runs: the model installed packages with
`run_command` as a background task (pulling gigabytes of CUDA wheels), then
killed the task, and the turn died right after. These checks reject such calls
before they run. The rejection goes back to the model as that tool's error
(see `harness_steps.recoverable_error`), so the run continues.

The agent's environment also pins PyTorch to CPU wheels for every install
(`cpu_only_installs`): Cloud Run has no GPU.
"""

from __future__ import annotations

import os
import re
from typing import Any

from google.antigravity.hooks import hooks as ag_hooks
from google.antigravity.types import HookResult, ToolCall

# Every rejection message starts with this, so it can be told apart from a
# user's denial (which ends the run).
BLOCKED = "Blocked by Repo Doctor:"

# Package installs, in any position of a shell command line.
_INSTALL = re.compile(
    r"""(?:^|[\s;&|(`'"/])(?:
        (?:python[\d.]*\s+-m\s+)?pip[\d.]*\s+(?:install|download)
      | uv\s+(?:pip\s+(?:install|sync)|add|sync|tool\s+install)
      | (?:npm|pnpm)\s+(?:install|i|ci|add)
      | yarn\s+(?:install|add)
      | bun\s+(?:install|i|add)
      | poetry\s+(?:install|add)
      | pipx\s+install
      | conda\s+install
      | mamba\s+install
      | (?:apt|apt-get|brew)\s+install
      | cargo\s+install
      | go\s+install
    )\b""",
    re.IGNORECASE | re.VERBOSE,
)

INSTALL_MESSAGE = (
    f"{BLOCKED} installing packages with run_command is not allowed. Call "
    "install_dependencies with the installCommand from clone_repo. To install "
    "the optional extras the failing CI step installs, write them into that "
    "command as `-e .[extra1,extra2]` (clone_repo lists the extras the project "
    "declares). PyTorch always installs as CPU wheels."
)
KILL_MESSAGE = (
    f"{BLOCKED} background tasks cannot be killed. Wait for the task's notice; "
    "it arrives when the command finishes. Meanwhile, keep working on something "
    "else or end the turn with a summary."
)

_RUN_COMMAND = "run_command"
_MANAGE_TASK = "manage_task"


def _name(call: ToolCall) -> str:
    raw = call.name
    return str(getattr(raw, "value", raw))


def _arg(args: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = args.get(key)
        if isinstance(value, str):
            return value
    return ""


def blocked_tool(message: str) -> str:
    """The tool a rejection message was about."""
    return _MANAGE_TASK if KILL_MESSAGE in message else _RUN_COMMAND


def is_install_command(command: str) -> bool:
    return bool(_INSTALL.search(command))


def rejection(call: ToolCall) -> str | None:
    """Why this call must not run, or None when it may."""
    name = _name(call)
    args = call.args if isinstance(call.args, dict) else {}
    if name == _RUN_COMMAND:
        command = _arg(args, "CommandLine", "command_line", "command", "Command")
        if is_install_command(command):
            return INSTALL_MESSAGE
    elif name == _MANAGE_TASK:
        action = _arg(args, "Action", "action").strip().lower()
        if action in {"kill", "stop", "cancel", "terminate"}:
            return KILL_MESSAGE
    return None


def guard_hook() -> Any:
    """A pre-tool decide hook that rejects the calls above. Goes first."""

    @ag_hooks.pre_tool_call_decide  # type: ignore[untyped-decorator]
    async def _guard(call: ToolCall) -> HookResult:
        reason = rejection(call)
        if reason is None:
            return HookResult(allow=True)
        return HookResult(allow=False, message=reason)

    return _guard


# CPU-only PyTorch for every install the agent runs (install_dependencies,
# and anything uv or pip resolves). uv: its torch backend; pip: the CPU wheel
# index, whose "+cpu" builds sort above the CUDA builds on PyPI.
CPU_ONLY_ENV = {
    "UV_TORCH_BACKEND": "cpu",
    "PIP_EXTRA_INDEX_URL": "https://download.pytorch.org/whl/cpu",
}


def cpu_only_installs() -> None:
    os.environ.update(CPU_ONLY_ENV)
