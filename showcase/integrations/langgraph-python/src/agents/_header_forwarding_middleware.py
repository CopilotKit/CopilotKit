"""Minimal header-forwarding-only AgentMiddleware.

Some showcase demos (reasoning, tool-rendering-reasoning-chain, the
sub-agents in `subagents.py`) intentionally avoid the full
`CopilotKitMiddleware` because they don't need its frontend-tool
injection, App-Context surfacing, or state-note features — they're
minimal demos of LangGraph capabilities.

But every showcase request goes through aimock (the locally-served
LLM mock), and aimock requires the ``x-aimock-context`` header (and
friends) on every ``/v1/responses`` and ``/v1/chat/completions``
request to match the right fixture. Without middleware to populate
the header-forwarding ContextVar from the LangGraph RunnableConfig
``configurable``, those requests go out without the header and aimock
returns 404, breaking the demo.

This middleware does ONLY that header propagation — nothing else.
It reuses copilotkit's own primitives (kept private but exported by
the installed package at the module level) so the propagation logic
is identical to the full middleware. No App-Context injection, no
tool-merging, no state-to-prompt surfacing, no Bedrock message
fix-up.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from langchain.agents.middleware import (
    AgentMiddleware,
    AgentState,
    ModelRequest,
    ModelResponse,
)

# Reuse the installed copilotkit's existing header-forwarding helpers so
# the behaviour stays bit-identical to the full CopilotKitMiddleware's
# header-propagation step.  These are module-level functions in
# copilotkit 0.1.93's copilotkit_lg_middleware module.
from copilotkit.copilotkit_lg_middleware import (
    _extract_forwarded_headers_from_config,
    _ensure_httpx_hook,
)


class HeaderForwardingMiddleware(AgentMiddleware[AgentState, Any]):
    """AgentMiddleware that only forwards inbound x-* headers.

    Behaviourally a no-op except for two calls inside both
    ``wrap_model_call`` and ``awrap_model_call``:

      1. ``_extract_forwarded_headers_from_config()`` — read the
         ``x-*`` keys from the active LangGraph RunnableConfig
         (``context`` and ``configurable``) and populate the
         header-forwarding ContextVar.
      2. ``_ensure_httpx_hook(request.model)`` — install copilotkit's
         httpx event hook on the model's underlying HTTP client(s)
         so the next outgoing LLM request picks the headers up.

    No App-Context injection, no tool-merging, no state-surfacing,
    no Bedrock message fix-up — strictly header propagation.
    """

    @property
    def name(self) -> str:
        return "HeaderForwardingMiddleware"

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        _extract_forwarded_headers_from_config()
        _ensure_httpx_hook(request.model)
        return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        _extract_forwarded_headers_from_config()
        _ensure_httpx_hook(request.model)
        return await handler(request)
