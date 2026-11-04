"""Build the agent's model from ``COPILOTKIT_AGENT_MODEL``.

``COPILOTKIT_AGENT_MODEL=<provider>:<model>`` (or ``<provider>/<model>``)
overrides the model; when it is unset the agent uses its default. Providers:
``openai``, ``anthropic``, ``google`` (``gemini`` and ``google-gemini`` are
aliases of ``google``). An OpenAI-compatible provider is
``openai:<its model id>`` plus ``OPENAI_BASE_URL``, which the OpenAI client
reads itself.
"""

import os
import re

from agno.models.base import Model
from agno.models.utils import get_model

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


def create_model(default_spec: str) -> Model:
    """Build the Agno model through Agno's own ``<provider>:<model>`` resolver.

    Our provider ids (openai, anthropic, google) are also Agno's, mapping to
    OpenAIChat, Claude and Gemini.

    Args:
        default_spec: The default when the variable is unset, e.g. ``"openai:gpt-4o"``.
    """
    provider, model = parse_agent_model(
        (os.getenv("COPILOTKIT_AGENT_MODEL") or "").strip() or default_spec
    )
    return get_model(f"{provider}:{model}")
