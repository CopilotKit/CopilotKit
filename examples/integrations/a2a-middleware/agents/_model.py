"""Resolve each agent's model from ``COPILOTKIT_AGENT_MODEL``.

``COPILOTKIT_AGENT_MODEL=<provider>:<model>`` (or ``<provider>/<model>``)
overrides the model of ALL THREE agents. When it is unset, each agent keeps
its own default (Gemini for the orchestrator and analysis agents, OpenAI for
the research agent). Providers: ``openai``, ``anthropic``, ``google``
(``gemini`` and ``google-gemini`` are aliases of ``google``). An
OpenAI-compatible provider is ``openai:<its model id>`` plus
``OPENAI_BASE_URL``, which LiteLLM and the OpenAI client read themselves.
"""

from __future__ import annotations

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


def _resolve(default_spec: str) -> tuple[str, str]:
    return parse_agent_model(
        (os.getenv("COPILOTKIT_AGENT_MODEL") or "").strip() or default_spec
    )


def adk_model(default_spec: str):
    """Return the ``model`` argument for an ADK ``LlmAgent``.

    Gemini runs natively in ADK; openai and anthropic go through ADK's LiteLLM
    wrapper.
    """
    provider, model = _resolve(default_spec)
    if provider == "google":
        return model
    from google.adk.models.lite_llm import LiteLlm

    return LiteLlm(model=f"{provider}/{model}")


# Our provider ids -> LangChain's init_chat_model provider ids.
_LANGCHAIN_PROVIDERS = {
    "openai": "openai",
    "anthropic": "anthropic",
    "google": "google_genai",
}


def langchain_model(default_spec: str, **kwargs):
    """Return a LangChain chat model for the research agent."""
    from langchain.chat_models import init_chat_model

    provider, model = _resolve(default_spec)
    return init_chat_model(
        model, model_provider=_LANGCHAIN_PROVIDERS[provider], **kwargs
    )
