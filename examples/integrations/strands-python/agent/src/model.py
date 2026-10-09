"""Build the agent's models from ``COPILOTKIT_AGENT_MODEL``.

The Strands agent itself uses a Strands model (``create_strands_model``); the
A2UI generator uses a LangChain chat model (``create_chat_model``).

``COPILOTKIT_AGENT_MODEL=<provider>:<model>`` (or ``<provider>/<model>``)
overrides EVERY model site in this agent. When it is unset, each site falls
back to its own default. Providers: ``openai``, ``anthropic``, ``google``
(``gemini`` and ``google-gemini`` are aliases of ``google``). An
OpenAI-compatible provider is ``openai:<its model id>`` plus
``OPENAI_BASE_URL``, which the OpenAI client reads itself.
"""

import os
import re

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel
from strands.models.model import Model

_PROVIDER_ALIASES = {
    "openai": "openai",
    "anthropic": "anthropic",
    "google": "google",
    "gemini": "google",
    "google-gemini": "google",
}
# Our provider ids -> LangChain's init_chat_model provider ids.
_LANGCHAIN_PROVIDERS = {
    "openai": "openai",
    "anthropic": "anthropic",
    "google": "google_genai",
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


def create_chat_model(default_spec: str, **openai_kwargs) -> BaseChatModel:
    """Build this site's chat model.

    Args:
        default_spec: This site's default, e.g. ``"openai:gpt-5.4"``.
        **openai_kwargs: Extra ChatOpenAI options, applied only for OpenAI.
    """
    provider, model = parse_agent_model(
        (os.getenv("COPILOTKIT_AGENT_MODEL") or "").strip() or default_spec
    )
    kwargs = openai_kwargs if provider == "openai" else {}
    return init_chat_model(
        model, model_provider=_LANGCHAIN_PROVIDERS[provider], **kwargs
    )


def create_strands_model(default_spec: str, openai_params: dict | None = None) -> Model:
    """Build the Strands model for the agent.

    Args:
        default_spec: This site's default, e.g. ``"openai:gpt-5.4"``.
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
        params=openai_params or {},
    )
