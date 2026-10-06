"""Shared wiring for every demo agent in this package.

Mirrors the AG-UI branch's ``examples/server/api/_common.py``: one workspace,
one harness pool, one save_dir, built-in tools reduced to ``finish``.
"""

from __future__ import annotations

import os

from google.antigravity import CapabilitiesConfig
from google.antigravity.models import DEFAULT_MODEL
from google.antigravity.types import BuiltinTools, GeminiAPIEndpoint

SLUG = "google-antigravity"

# Keep the workspace path SHORT and stable. A long high-entropy path makes the
# model reproduce it wrongly in tool calls and the run dies mid-call with an
# unrelated-looking error (measured 2/14 failures at 75 chars, 0/14 at 9).
WORKSPACE = os.environ.get("ANTIGRAVITY_WORKSPACE", "/data/ws")
SAVE_DIR = os.environ.get("ANTIGRAVITY_SAVE_DIR", "/data/sessions")

MODEL = os.environ.get("ANTIGRAVITY_MODEL", DEFAULT_MODEL)

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
# Bounds a turn that never stops calling tools. A turn keeps running after its
# client disconnects, so without this a model or fixture that re-issues the
# same call runs until the process dies (PNI-570/PNI-571: thousands of cycles
# per stream on staging). The demos' longest turn makes 7 calls.
MAX_TOOL_CALLS_PER_TURN = int(
    os.environ.get("ANTIGRAVITY_MAX_TOOL_CALLS_PER_TURN", "50")
)
REASONING_MODEL = os.environ.get("ANTIGRAVITY_REASONING_MODEL", DEFAULT_MODEL)


# @region[agent-setup]
def api_key() -> str | None:
    """The Gemini API key.

    ``GEMINI_API_KEY`` is the only name the Antigravity SDK reads. The showcase
    fleet exports ``GOOGLE_API_KEY`` for its Gemini integrations, so accept
    that too rather than fail on the first model call.
    """
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def gemini_base_url() -> str | None:
    """The Gemini-compatible server to call instead of Google's API.

    Showcase compose sets ``GOOGLE_GEMINI_BASE_URL=http://aimock:4010``, the
    same variable the google-adk integration reads.
    """
    return os.environ.get("GOOGLE_GEMINI_BASE_URL", "").rstrip("/") or None


def endpoint() -> GeminiAPIEndpoint | None:
    """Where every model call goes: aimock under compose, Google's API otherwise.

    Against aimock, the ``X-AIMock-Context`` header selects this package's
    fixtures. The harness makes the model calls itself, so the header has to
    ride on the endpoint rather than on a request this code sends.
    """
    base_url = gemini_base_url()
    if base_url is None:
        return None
    return GeminiAPIEndpoint(
        base_url=base_url,
        api_key=api_key(),
        http_headers={"X-AIMock-Context": SLUG},
    )


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
        api_key=api_key(),
        endpoint=endpoint(),
        workspaces=[WORKSPACE],
        save_dir=SAVE_DIR,
        harness_pool=shared_pool(),
        capabilities=chat_only_capabilities(),
        session_timeout_seconds=SESSION_TIMEOUT_SECONDS,
        max_sessions=MAX_SESSIONS,
        max_tool_calls_per_turn=MAX_TOOL_CALLS_PER_TURN,
    )
    defaults.update(kwargs)
    return AntigravityAgent(**defaults)


# @endregion[agent-setup]
