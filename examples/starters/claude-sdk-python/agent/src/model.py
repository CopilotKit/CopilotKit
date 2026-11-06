"""Model selection shared across the agent's tools and the adapter."""

from __future__ import annotations

import logging
import os
import re

DEFAULT_CLAUDE_MODEL = "claude-sonnet-5"

_AGENT_MODEL_SPEC = re.compile(r"^([A-Za-z0-9-]+)[:/](.+)$")
_warned_agent_model: str | None = None
logger = logging.getLogger(__name__)


def _agent_model_from_env() -> str | None:
    """The Claude model named by ``COPILOTKIT_AGENT_MODEL``, if usable.

    ``COPILOTKIT_AGENT_MODEL=<provider>:<model>`` (or ``<provider>/<model>``).
    The Claude Agent SDK runs only Anthropic models, so only the ``anthropic``
    provider is accepted; any other value is logged once and ignored.
    """
    global _warned_agent_model
    value = (os.getenv("COPILOTKIT_AGENT_MODEL") or "").strip()
    if not value:
        return None
    match = _AGENT_MODEL_SPEC.match(value)
    if match and match.group(1).lower() == "anthropic":
        return match.group(2)
    if _warned_agent_model != value:
        _warned_agent_model = value
        logger.warning(
            '[model] COPILOTKIT_AGENT_MODEL="%s" ignored: the Claude Agent SDK runs '
            "only anthropic:<model>; falling back to CLAUDE_MODEL / ANTHROPIC_MODEL / %s.",
            value,
            DEFAULT_CLAUDE_MODEL,
        )
    return None


def resolve_model() -> str:
    """Resolve the Claude model id from the environment.

    ``COPILOTKIT_AGENT_MODEL`` (anthropic only) wins and overrides every model
    site in the agent; then ``CLAUDE_MODEL``, then ``ANTHROPIC_MODEL``, then
    the default. A dotted marketing name from any of them (e.g.
    ``claude-sonnet-4.6``) is normalized to the API id (``claude-sonnet-4-6``).
    """
    raw = (
        _agent_model_from_env()
        or os.getenv("CLAUDE_MODEL")
        or os.getenv("ANTHROPIC_MODEL")
        or DEFAULT_CLAUDE_MODEL
    )
    return raw.replace(".", "-")
