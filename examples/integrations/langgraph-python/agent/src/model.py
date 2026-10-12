"""Build the agent's chat model from ``COPILOTKIT_AGENT_MODEL``.

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
