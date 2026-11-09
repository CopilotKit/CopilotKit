"""Build the agent's LLM from ``COPILOTKIT_AGENT_MODEL``.

``COPILOTKIT_AGENT_MODEL=<provider>:<model>`` (or ``<provider>/<model>``)
overrides the model; when it is unset the agent uses its default. Providers:
``openai``, ``anthropic``, ``google`` (``gemini`` and ``google-gemini`` are
aliases of ``google``). An OpenAI-compatible provider is
``openai:<its model id>`` plus ``OPENAI_BASE_URL``.
"""

import os
import re

import tiktoken

from llama_index.core.base.llms.types import LLMMetadata
from llama_index.core.llms.function_calling import FunctionCallingLLM
from llama_index.llms.openai import OpenAI
from llama_index.llms.openai.utils import ALL_AVAILABLE_MODELS

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


class CompatibleModelMetadata:
    """Mixin for an OpenAI LLM whose model id is outside LlamaIndex's table.

    LlamaIndex's OpenAI LLM looks up a context window for the model id and
    rejects ids it does not know, which is every OpenAI-compatible provider's
    model. Luna has explicit metadata; other unknown models use generic
    chat + function-calling metadata.
    """

    @property
    def metadata(self) -> LLMMetadata:
        return LLMMetadata(
            context_window=1_050_000 if self.model == "gpt-6-luna" else 128000,
            num_output=self.max_tokens or -1,
            is_chat_model=True,
            is_function_calling_model=True,
            model_name=self.model,
        )

    @property
    def _tokenizer(self):
        if self.model == "gpt-6-luna":
            return tiktoken.get_encoding("o200k_base")
        return super()._tokenizer

    def _get_model_kwargs(self, **kwargs):
        params = super()._get_model_kwargs(**kwargs)
        if self.model == "gpt-6-luna":
            params["reasoning_effort"] = "none"
            if "max_tokens" in params:
                params["max_completion_tokens"] = params.pop("max_tokens")
        return params


def create_llm(
    default_spec: str,
    openai_class: type[OpenAI] = OpenAI,
    **openai_kwargs,
) -> FunctionCallingLLM:
    """Build the LlamaIndex LLM.

    Args:
        default_spec: The default when the variable is unset, e.g. ``"openai:gpt-6-luna"``.
        openai_class: The OpenAI LLM class to use for the openai provider.
        **openai_kwargs: OpenAI client options, applied only for OpenAI.
    """
    provider, model = parse_agent_model(
        (os.getenv("COPILOTKIT_AGENT_MODEL") or "").strip() or default_spec
    )
    if provider == "anthropic":
        from llama_index.llms.anthropic import Anthropic

        return Anthropic(model=model)
    if provider == "google":
        from llama_index.llms.google_genai import GoogleGenAI

        return GoogleGenAI(model=model)

    # LlamaIndex's OpenAI LLM resolves its base URL from OPENAI_API_BASE only, so
    # the conventional OPENAI_BASE_URL (used by the OpenAI SDKs and by our
    # aimock-backed docker-compose.test.yml) is ignored and requests go to
    # api.openai.com. Forward it explicitly as api_base.
    base_url = os.environ.get("OPENAI_BASE_URL")
    kwargs = dict(openai_kwargs)
    if base_url:
        kwargs.setdefault("api_base", base_url)
    if model in ALL_AVAILABLE_MODELS and model != "gpt-6-luna":
        return openai_class(model=model, **kwargs)
    compatible_class = type(
        f"Compatible{openai_class.__name__}",
        (CompatibleModelMetadata, openai_class),
        {},
    )
    return compatible_class(model=model, **kwargs)
