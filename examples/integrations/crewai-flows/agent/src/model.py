"""Resolve the agent's model from ``COPILOTKIT_AGENT_MODEL``.

``COPILOTKIT_AGENT_MODEL=<provider>:<model>`` (or ``<provider>/<model>``)
overrides the model; when it is unset the agent uses its default. Providers:
``openai``, ``anthropic``, ``google`` (``gemini`` and ``google-gemini`` are
aliases of ``google``). An OpenAI-compatible provider is
``openai:<its model id>`` plus ``OPENAI_BASE_URL``, which LiteLLM reads
itself.
"""

import os
import re

_PROVIDER_ALIASES = {
    "openai": "openai",
    "anthropic": "anthropic",
    "google": "google",
    "gemini": "google",
    "google-gemini": "google",
}
_SPEC = re.compile(r"^([A-Za-z0-9-]+)[:/](.+)$")


def parse_agent_model(value: str) -> tuple[str, str]:
    """Split ``<provider>:<model>`` into (provider, model); the model id is kept unchanged."""
    match = _SPEC.match(value.strip())
    provider = match and _PROVIDER_ALIASES.get(match.group(1).lower())
    if not match or not provider:
        raise ValueError(
            f'COPILOTKIT_AGENT_MODEL="{value}" is not <provider>:<model> '
            "with provider openai, anthropic or google"
        )
    return provider, match.group(2)


# Our provider ids -> LiteLLM provider prefixes. LiteLLM's gemini provider is
# Google AI Studio and reads GOOGLE_API_KEY (or GEMINI_API_KEY).
_LITELLM_PREFIXES = {
    "openai": "openai",
    "anthropic": "anthropic",
    "google": "gemini",
}


def resolve_model(default_spec: str) -> str:
    """Return a LiteLLM model string, e.g. ``"anthropic/claude-sonnet-4-6"``.

    Args:
        default_spec: The default when the variable is unset, e.g. ``"openai:gpt-5-mini"``.
    """
    provider, model = parse_agent_model(
        (os.getenv("COPILOTKIT_AGENT_MODEL") or "").strip() or default_spec
    )
    return f"{_LITELLM_PREFIXES[provider]}/{model}"
