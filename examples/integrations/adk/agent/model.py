"""Resolve the agent's model from ``COPILOTKIT_AGENT_MODEL``.

``COPILOTKIT_AGENT_MODEL=<provider>:<model>`` (or ``<provider>/<model>``)
overrides the model; when it is unset the agent uses its default. Providers:
``google`` (also ``gemini`` / ``google-gemini``) runs natively in ADK and
reads GOOGLE_API_KEY; ``openai`` and ``anthropic`` run through ADK's
documented LiteLLM wrapper and read OPENAI_API_KEY / ANTHROPIC_API_KEY. An
OpenAI-compatible provider is ``openai:<its model id>`` plus
``OPENAI_BASE_URL``, which LiteLLM reads itself.
"""

import os
import re

from google.adk.models.base_llm import BaseLlm
from google.adk.models.lite_llm import LiteLlm

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


def resolve_model(default_spec: str) -> str | BaseLlm:
    """Return the ``model`` argument for an ADK ``LlmAgent``.

    Args:
        default_spec: The default when the variable is unset, e.g. ``"google:gemini-3.8-flash"``.
    """
    provider, model = parse_agent_model(
        (os.getenv("COPILOTKIT_AGENT_MODEL") or "").strip() or default_spec
    )
    if provider == "google":
        return model
    return LiteLlm(model=f"{provider}/{model}")
