"""Build the agent's Strands model from ``COPILOTKIT_AGENT_MODEL``.

``COPILOTKIT_AGENT_MODEL=<provider>:<model>`` (or ``<provider>/<model>``)
overrides the model. When it is unset, the site's own default is used.
Providers: ``openai``, ``anthropic``, ``google`` (``gemini`` and
``google-gemini`` are aliases of ``google``). An
OpenAI-compatible provider is ``openai:<its model id>`` plus
``OPENAI_BASE_URL``, which the OpenAI client reads itself.
"""

import os
import re

from strands.models.model import Model

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


def create_strands_model(default_spec: str, openai_params: dict | None = None) -> Model:
    """Build the Strands model for the agent.

    Args:
        default_spec: This site's default, e.g. ``"openai:gpt-6-luna"``.
        openai_params: Extra request params, applied only for OpenAI.
    """
    provider, model = parse_agent_model(
        (os.getenv("COPILOTKIT_AGENT_MODEL") or "").strip() or default_spec
    )
    if provider == "anthropic":
        from strands.models.anthropic import AnthropicModel

        # Strands requires max_tokens for Anthropic; the key comes from
        # ANTHROPIC_API_KEY.
        return AnthropicModel(model_id=model, max_tokens=8192)
    if provider == "google":
        from strands.models.gemini import GeminiModel

        # The google-genai client reads GOOGLE_API_KEY.
        return GeminiModel(model_id=model)

    from strands.models.openai import OpenAIModel

    return OpenAIModel(
        client_args={"api_key": os.getenv("OPENAI_API_KEY", "")},
        model_id=model,
        params={
            **(openai_params or {}),
            **({"reasoning_effort": "none"} if model == "gpt-6-luna" else {}),
        },
    )
