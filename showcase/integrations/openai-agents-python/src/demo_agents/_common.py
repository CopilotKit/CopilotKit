"""Shared wiring for every demo agent in this package.

One ``AsyncOpenAI`` client for the whole process. It reads ``OPENAI_API_KEY``
and ``OPENAI_BASE_URL`` from the environment (showcase compose points the
latter at the in-network aimock), and forwards the current request's mock and
diagnostic headers onto every model call: the main agent turns, the
sub-agents and the A2UI renderer all go through it.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from agents import ModelSettings, set_default_openai_client, set_tracing_disabled
from openai import AsyncOpenAI
from openai.types.shared import Reasoning

from demo_agents._header_forwarding import get_forwarded_headers

SLUG = "openai-agents-python"

# Same default model as the other OpenAI-backed showcase integrations.
# Override with OPENAI_MODEL.
MODEL = os.environ.get("OPENAI_MODEL", "gpt-6-luna")
# Reasoning demos need a model that returns reasoning summaries.
REASONING_MODEL = os.environ.get("OPENAI_REASONING_MODEL", MODEL)
# The chat agents run Luna with reasoning off, as the other integrations do;
# only the reasoning demos let it think (see reasoning_settings). Another
# model keeps the API's default, since not every model takes an effort.
CHAT_REASONING = Reasoning(effort="none") if MODEL == "gpt-6-luna" else None

# Inbound headers worth carrying onto the model call, when the request has
# them: X-AIMock-Strict turns a fixture miss into a failure instead of a proxy
# to the real provider, and x-test-id / x-diag-* let the harness find this
# run's calls in aimock's journal. Everything else (x-forwarded-for, ...) stays.
_FORWARDED_PREFIXES = ("x-aimock-", "x-test-id", "x-diag-")


# @region[agent-setup]
async def _forward_request_headers(request: httpx.Request) -> None:
    """Copies the current request's mock/diagnostic headers onto a model call.

    ``x-aimock-context`` is fixed to this package's slug so aimock picks this
    package's fixtures whatever the inbound request carried. The rest is
    forwarded only when present, so ordinary demo traffic is never forced
    into strict mode.
    """
    for key, value in get_forwarded_headers().items():
        if key.startswith(_FORWARDED_PREFIXES):
            request.headers[key] = value
    request.headers["x-aimock-context"] = SLUG


_CLIENT: AsyncOpenAI | None = None


def openai_client() -> AsyncOpenAI:
    """The process-wide client every model call goes through."""
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = AsyncOpenAI(
            http_client=httpx.AsyncClient(
                timeout=httpx.Timeout(120.0, connect=10.0),
                event_hooks={"request": [_forward_request_headers]},
            )
        )
    return _CLIENT


def configure_sdk() -> None:
    """Points the Agents SDK at ``openai_client()``. Call once at startup.

    Tracing is off unless OPENAI_AGENTS_TRACING=1: traces go to the OpenAI
    platform, which the mock key and the aimock base URL cannot reach.
    """
    set_default_openai_client(openai_client(), use_for_tracing=False)
    if os.environ.get("OPENAI_AGENTS_TRACING") != "1":
        set_tracing_disabled(True)


async def close_client() -> None:
    global _CLIENT
    client, _CLIENT = _CLIENT, None
    if client is not None:
        await client.close()


# @endregion[agent-setup]


def chat_settings(**settings: Any) -> ModelSettings:
    """Model settings for a chat agent: ``settings`` with ``CHAT_REASONING``."""
    return ModelSettings(reasoning=CHAT_REASONING, **settings)


def reasoning_settings() -> ModelSettings:
    """Model settings that make the Responses API stream reasoning summaries."""
    return ModelSettings(reasoning=Reasoning(effort="low", summary="auto"))
