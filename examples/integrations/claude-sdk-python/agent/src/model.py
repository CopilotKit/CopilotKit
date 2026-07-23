"""Model selection shared across the agent's tools and the adapter."""

from __future__ import annotations

import os

DEFAULT_CLAUDE_MODEL = "claude-sonnet-5"


def resolve_model() -> str:
    """Resolve the Claude model id from the environment.

    Prefers ``CLAUDE_MODEL``, then ``ANTHROPIC_MODEL``, then the default. A
    dotted marketing name (e.g. ``claude-sonnet-4.5``) is normalized to the API
    id (``claude-sonnet-4-5``).
    """
    raw = (
        os.getenv("CLAUDE_MODEL")
        or os.getenv("ANTHROPIC_MODEL")
        or DEFAULT_CLAUDE_MODEL
    )
    return raw.replace(".", "-")
