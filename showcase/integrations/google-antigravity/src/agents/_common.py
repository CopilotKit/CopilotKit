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
os.makedirs(WORKSPACE, exist_ok=True)
os.makedirs(SAVE_DIR, exist_ok=True)

MODEL = os.environ.get("ANTIGRAVITY_MODEL", "gpt-4.1-mini")
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

    defaults = dict(
        model=MODEL,
        base_url=base_url(),
        workspaces=[WORKSPACE],
        save_dir=SAVE_DIR,
        harness_pool=shared_pool(),
        capabilities=chat_only_capabilities(),
    )
    defaults.update(kwargs)
    return AntigravityAgent(**defaults)
