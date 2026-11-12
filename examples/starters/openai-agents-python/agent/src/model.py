"""Resolve the agent's model from ``COPILOTKIT_AGENT_MODEL``.

``COPILOTKIT_AGENT_MODEL=openai:<model>`` (or ``openai/<model>``) overrides
the model; when it is unset the agent uses its default. The OpenAI Agents SDK
talks to OpenAI, so ``openai`` is the only provider. An OpenAI-compatible
provider is ``openai:<its model id>`` plus ``OPENAI_BASE_URL``, which the
OpenAI client reads itself; on such a host the agent uses Chat Completions.
"""

import os
import re
from urllib.parse import urlparse

from agents import ModelSettings, set_default_openai_api, set_tracing_disabled
from openai.types.shared import Reasoning

_SPEC = re.compile(r"^([A-Za-z0-9-]+)[:/](.+)$")


def parse_agent_model(value: str) -> str:
    """Return the model id of ``openai:<model>``, kept unchanged."""
    match = _SPEC.match(value.strip())
    if not match or match.group(1).lower() != "openai":
        raise ValueError(
            f'COPILOTKIT_AGENT_MODEL="{value}" is not openai:<model>. The OpenAI '
            "Agents SDK runs OpenAI models; for an OpenAI-compatible provider use "
            "openai:<its model id> and set OPENAI_BASE_URL"
        )
    return match.group(2)


def uses_chat_completions() -> bool:
    """Whether ``OPENAI_BASE_URL`` points at an OpenAI-compatible provider.

    Most compatible providers serve only ``{base}/chat/completions``, not the
    Responses API, so those get Chat Completions. OpenAI's own hosts
    (``api.openai.com``, regional ``*.api.openai.com``), Azure OpenAI
    (``*.openai.azure.com``), an unset variable and an unparseable URL keep
    the Responses API. Same rule as the CopilotKit runtime (PE-706).
    """
    base_url = (os.getenv("OPENAI_BASE_URL") or "").strip()
    if not base_url:
        return False
    try:
        hostname = (urlparse(base_url).hostname or "").lower()
    except ValueError:
        return False
    if not hostname:
        return False
    is_openai_host = (
        hostname == "api.openai.com"
        or hostname.endswith(".api.openai.com")
        or hostname.endswith(".openai.azure.com")
    )
    return not is_openai_host


def resolve_model(default_spec: str) -> str:
    """Return the model id to run, e.g. ``"gpt-6-luna"``.

    Args:
        default_spec: The default when the variable is unset, e.g. ``"openai:gpt-6-luna"``.
    """
    return parse_agent_model(
        (os.getenv("COPILOTKIT_AGENT_MODEL") or "").strip() or default_spec
    )


def model_settings(model: str) -> ModelSettings:
    """Run Luna with reasoning off, so it calls tools without thinking first.

    Other models keep the API's default, since not every model takes an effort.
    """
    if model == "gpt-6-luna":
        return ModelSettings(reasoning=Reasoning(effort="none"))
    return ModelSettings()


def configure_sdk() -> None:
    """Point the Agents SDK at the API ``OPENAI_BASE_URL`` serves. Call once at startup.

    The SDK sends traces to the OpenAI platform with ``OPENAI_API_KEY``. A
    compatible provider's key cannot reach it, so tracing is off there.
    """
    if uses_chat_completions():
        set_default_openai_api("chat_completions")
        set_tracing_disabled(True)
