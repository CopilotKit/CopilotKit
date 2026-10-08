"""Resolve the agent's model from ``COPILOTKIT_AGENT_MODEL``.

``COPILOTKIT_AGENT_MODEL=<provider>:<model>`` (or ``<provider>/<model>``)
overrides the model; when it is unset the agent uses its default. Providers:
``openai``, ``anthropic``, ``google`` (``gemini`` and ``google-gemini`` are
aliases of ``google``). An OpenAI-compatible provider is
``openai:<its model id>`` plus ``OPENAI_BASE_URL``, which Pydantic AI's OpenAI
provider reads itself; on such a host the agent uses Chat Completions.
"""

import os
import re
from urllib.parse import urlparse

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
# Responses API this starter has always used (but see uses_chat_completions).
_PYDANTIC_AI_PREFIXES = {
    "openai": "openai-responses",
    "anthropic": "anthropic",
    "google": "google",
}


def uses_chat_completions() -> bool:
    """Whether ``OPENAI_BASE_URL`` points at an OpenAI-compatible provider.

    Most compatible providers serve only ``{base}/chat/completions``, not the
    Responses API, so those get Pydantic AI's Chat Completions model
    (``openai-chat``). OpenAI itself, an unset variable and an unparseable URL
    keep the Responses API.
    """
    base_url = os.getenv("OPENAI_BASE_URL")
    if not base_url:
        return False
    try:
        hostname = urlparse(base_url).hostname
    except ValueError:
        return False
    return bool(hostname) and hostname != "api.openai.com"


def resolve_model(default_spec: str) -> str:
    """Return a Pydantic AI model string, e.g. ``"anthropic:claude-sonnet-4-5"``.

    Args:
        default_spec: The default when the variable is unset, e.g. ``"openai:gpt-5-mini"``.
    """
    provider, model = parse_agent_model(
        os.getenv("COPILOTKIT_AGENT_MODEL") or default_spec
    )
    prefix = _PYDANTIC_AI_PREFIXES[provider]
    if provider == "openai" and uses_chat_completions():
        prefix = "openai-chat"
    return f"{prefix}:{model}"
