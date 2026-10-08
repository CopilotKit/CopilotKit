"""Resolve the agent's model from ``COPILOTKIT_AGENT_MODEL``.

``COPILOTKIT_AGENT_MODEL=<provider>:<model>`` (or ``<provider>/<model>``)
overrides the model; when it is unset the agent uses its default. Providers:
``openai``, ``anthropic``, ``google`` (``gemini`` and ``google-gemini`` are
aliases of ``google``). An OpenAI-compatible provider is
``openai:<its model id>`` plus ``OPENAI_BASE_URL``, which Pydantic AI's OpenAI
provider reads itself.
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


# Our provider ids -> Pydantic AI model-string prefixes. OpenAI keeps the
# Responses API this starter has always used.
_PYDANTIC_AI_PREFIXES = {
    "openai": "openai-responses",
    "anthropic": "anthropic",
    "google": "google",
}


def resolve_model(default_spec: str) -> str:
    """Return a Pydantic AI model string, e.g. ``"anthropic:claude-sonnet-4-5"``.

    Args:
        default_spec: The default when the variable is unset, e.g. ``"openai:gpt-5-mini"``.
    """
    provider, model = parse_agent_model(
        os.getenv("COPILOTKIT_AGENT_MODEL") or default_spec
    )
    return f"{_PYDANTIC_AI_PREFIXES[provider]}:{model}"
