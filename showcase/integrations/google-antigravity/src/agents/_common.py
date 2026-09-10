"""Shared wiring for every demo agent in this package.

Mirrors the AG-UI branch's ``examples/server/api/_common.py``: one workspace,
one harness pool, one save_dir, built-in tools reduced to ``finish``.
"""

from __future__ import annotations

import os

from google.antigravity import CapabilitiesConfig
from google.antigravity.types import BuiltinTools

from openai_proxy import start_background

SLUG = "google-antigravity"

# Keep the workspace path SHORT and stable. A long high-entropy path makes the
# model reproduce it wrongly in tool calls and the run dies mid-call with an
# unrelated-looking error (measured 2/14 failures at 75 chars, 0/14 at 9).
WORKSPACE = os.environ.get("ANTIGRAVITY_WORKSPACE", "/data/ws")
SAVE_DIR = os.environ.get("ANTIGRAVITY_SAVE_DIR", "/data/sessions")

MODEL = os.environ.get("ANTIGRAVITY_MODEL", "gpt-4.1-mini")

# Session budget. The adapter defaults (50 live sessions per agent instance,
# reclaimed after 30 min idle) fit a chat product, not a probe fleet: every E2E
# test is a fresh thread_id, and the neutral agent backs eleven demo names, so
# two D6 sweeps exhaust the budget and every later run fails with SESSION_LIMIT.
# An abandoned probe thread never comes back, and a thread that does come back
# cold-resumes from save_dir, so a short idle timeout costs no continuity. With
# the harness pool an idle session is ~1 MB, so the higher cap is cheap.
SESSION_TIMEOUT_SECONDS = int(
    os.environ.get("ANTIGRAVITY_SESSION_TIMEOUT_SECONDS", "300")
)
MAX_SESSIONS = int(os.environ.get("ANTIGRAVITY_MAX_SESSIONS", "200"))
REASONING_MODEL = os.environ.get("ANTIGRAVITY_REASONING_MODEL", "gpt-5-mini")


def _upstream() -> str:
    """The OpenAI-compatible root the shim forwards to.

    ``OPENAI_BASE_URL`` follows the OpenAI SDK convention and ends in ``/v1``
    (compose sets ``http://aimock:4010/v1``). The harness appends
    ``/v1/chat/completions`` itself, so the shim's upstream is the root.
    """
    base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
    return base[: -len("/v1")] if base.rstrip("/").endswith("/v1") else base.rstrip("/")


_BASE_URL: str | None = None


def base_url() -> str:
    """Starts the shim once and returns the base_url every agent uses."""
    global _BASE_URL
    if _BASE_URL is None:
        _BASE_URL = start_background(
            port=int(os.environ.get("ANTIGRAVITY_SHIM_PORT", "8931")),
            upstream=_upstream(),
            extra_headers={"X-AIMock-Context": SLUG},
        )
    return _BASE_URL


def chat_only_capabilities() -> CapabilitiesConfig:
    """Only ``finish`` stays enabled.

    ``search_web`` returns an empty summary without Google credentials and the
    model retries it forever; ``ask_question`` would park on an interrupt the
    CopilotKit demos never answer. ``finish`` is how the harness ends a turn.
    """
    return CapabilitiesConfig(
        enabled_tools=[BuiltinTools.FINISH], enable_subagents=False
    )


_DIRS_READY = False


def _ensure_dirs() -> None:
    """Creates the workspace / save_dir once, on first agent construction.

    Deliberately NOT done at import time: the defaults live under ``/data``,
    which only exists inside the container image, so an import-time
    ``os.makedirs`` blows up on a developer machine (read-only ``/`` on macOS)
    and takes every ``import agent_server`` — including the package's pytest
    suite — down with it.
    """
    global _DIRS_READY
    if _DIRS_READY:
        return
    os.makedirs(WORKSPACE, exist_ok=True)
    os.makedirs(SAVE_DIR, exist_ok=True)
    _DIRS_READY = True


_POOL = None


def shared_pool():
    """One HarnessPool for the whole server: one Go process, not one per agent."""
    global _POOL
    if _POOL is None:
        from ag_ui_antigravity.harness_pool import HarnessPool

        _POOL = HarnessPool()
    return _POOL


def build(**kwargs):
    """Creates an AntigravityAgent with the package defaults applied."""
    from ag_ui_antigravity import AntigravityAgent

    _ensure_dirs()

    defaults = dict(
        model=MODEL,
        base_url=base_url(),
        workspaces=[WORKSPACE],
        save_dir=SAVE_DIR,
        harness_pool=shared_pool(),
        capabilities=chat_only_capabilities(),
        session_timeout_seconds=SESSION_TIMEOUT_SECONDS,
        max_sessions=MAX_SESSIONS,
    )
    defaults.update(kwargs)
    return AntigravityAgent(**defaults)
