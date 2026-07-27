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

CVDIAG instrumentation (diagnostic only — DOES NOT change WHERE
headers come from): after the existing
``_extract_forwarded_headers_from_config()`` populates copilotkit's
forwarded-headers ContextVar, we read it back via
``get_forwarded_headers()`` and emit a structured ``CVDIAG`` log line
at the configurable-read boundary recording whether
``x-aimock-context`` actually arrived on the LangGraph configurable
channel (``header_present=false`` is the alarm we are hunting). We
also append this layer's hop tag to ``x-diag-hops`` on the SAME
ContextVar the httpx hook already forwards from — so the breadcrumb
and correlation headers (``x-diag-run-id``, ``x-diag-hops``) ride
along on the outbound LLM call exactly the way ``x-aimock-context``
does, without introducing any new forwarding source.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Awaitable, Callable, Dict

from langchain.agents.middleware import (
    AgentMiddleware,
    AgentState,
    ModelRequest,
    ModelResponse,
)

# Reuse the installed copilotkit's existing header-forwarding helpers so
# the behaviour stays bit-identical to the full CopilotKitMiddleware's
# header-propagation step.  These are module-level functions in
# copilotkit 0.1.94's copilotkit_lg_middleware module.
from copilotkit.copilotkit_lg_middleware import (
    _extract_forwarded_headers_from_config,
    _ensure_httpx_hook,
)

# CVDIAG-only: read/append the forwarded-header ContextVar copilotkit
# already populates. set_forwarded_headers is used SOLELY to append the
# diagnostic hop breadcrumb onto the SAME channel x-aimock-context rides;
# it does not introduce a new forwarding source.
from copilotkit.header_propagation import (
    get_forwarded_headers,
    set_forwarded_headers,
)

# CVDIAG schema-v1 backend emitter (L1-I). Dual-emit: this rides ALONGSIDE the
# legacy free-form _cvdiag() log lines below — it writes the structured
# schema-v1 CVDIAG envelope through the shared single-source emitter, guarded by
# CVDIAG_BACKEND_EMITTER (default OFF). With the guard off it is a pure no-op.
from src.agents._cvdiag_backend import CvdiagBackendRun

logger = logging.getLogger(__name__)

_CVDIAG_COMPONENT = "backend-langgraph-py"
_CVDIAG_HOP_TAG = "backend-langgraph-py"


def _cvdiag(
    boundary: str,
    headers: Dict[str, str],
    status: str,
    *,
    hop: Any = "-",
    error: str = "",
) -> None:
    """Emit a single CVDIAG log line in the shared cross-language convention.

    Never logs full header values — only a 12-char prefix of
    ``x-aimock-context``.
    """
    slug = headers.get("x-aimock-context")
    header_present = isinstance(slug, str) and len(slug) > 0
    run_id = headers.get("x-diag-run-id", "none")
    test_id = headers.get("x-test-id", "none")
    prefix = slug[:12] if header_present else ""
    logger.info(
        "CVDIAG component=%s boundary=%s run_id=%s slug=%s "
        "header_present=%s header_value_prefix=%s hop=%s status=%s "
        "test_id=%s error=%s",
        _CVDIAG_COMPONENT,
        boundary,
        run_id,
        slug if header_present else "MISSING",
        str(header_present).lower(),
        prefix,
        hop,
        status,
        test_id,
        error,
    )


def _instrument_and_breadcrumb() -> None:
    """Read the configurable-read result, log it, and append the diag hop.

    Called immediately AFTER
    ``_extract_forwarded_headers_from_config()`` has populated the
    ContextVar. Reads the headers back, emits the configurable-read
    CVDIAG line (wrapping the previously-silent "no x-aimock-context in
    configurable" case as an alarm), then — only when x-aimock-context
    is present — appends this layer's hop tag to ``x-diag-hops`` on the
    SAME ContextVar so the breadcrumb rides the existing forwarding path.
    """
    headers = dict(get_forwarded_headers())
    has_context = (
        isinstance(headers.get("x-aimock-context"), str)
        and len(headers.get("x-aimock-context", "")) > 0
    )

    if has_context:
        _cvdiag("configurable-read", headers, "ok")
    else:
        # The alarm we are hunting: the configurable channel reached this
        # middleware without x-aimock-context. Surface it instead of the
        # previous silent no-op.
        _cvdiag(
            "configurable-read",
            headers,
            "miss" if headers else "error",
            error="x-aimock-context-absent-in-configurable"
            if headers
            else "no-forwarded-headers-in-configurable",
        )
        # Nothing to breadcrumb onto — do not invent a forwarding source.
        return

    # Append this layer's hop tag to x-diag-hops on the SAME ContextVar the
    # httpx hook forwards from. This rides the existing path; no new source.
    existing_hops = headers.get("x-diag-hops", "")
    headers["x-diag-hops"] = (
        f"{existing_hops},{_CVDIAG_HOP_TAG}"
        if isinstance(existing_hops, str) and existing_hops
        else _CVDIAG_HOP_TAG
    )
    set_forwarded_headers(headers)

    hop = len([h for h in headers["x-diag-hops"].split(",") if h])
    _cvdiag("outbound-llm", headers, "ok", hop=hop)


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

    CVDIAG: ``_instrument_and_breadcrumb()`` is inserted between the
    two steps purely to OBSERVE the configurable-read boundary and tag
    the existing breadcrumb. It does not change where headers come from.
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
        _instrument_and_breadcrumb()
        _ensure_httpx_hook(request.model)

        # CVDIAG schema-v1 dual-emit (L1-I). No-op when CVDIAG_BACKEND_EMITTER off.
        headers = dict(get_forwarded_headers())
        run = CvdiagBackendRun(headers)
        model_name = _model_name(request)
        run.request_ingress()
        run.agent_enter(agent_name=self.name, model_id=model_name)
        run.llm_call_start(provider="langchain", model=model_name)
        run.emit_heartbeat_once()
        start_ns = time.monotonic_ns()
        try:
            response = handler(request)
        except BaseException as exc:  # noqa: BLE001 - re-raised after observing
            run.error_caught(exc)
            run.agent_exit(terminal_outcome="err")
            raise
        latency_ms = int((time.monotonic_ns() - start_ns) / 1_000_000)
        run.llm_call_response(
            provider="langchain", model=model_name, latency_ms=latency_ms
        )
        run.sse_first_byte()
        run.sse_event(event_type="response", payload_size_bytes=None)
        run.agent_exit(terminal_outcome="ok")
        run.response_complete(http_status=200)
        return response

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        _extract_forwarded_headers_from_config()
        _instrument_and_breadcrumb()
        _ensure_httpx_hook(request.model)

        # CVDIAG schema-v1 dual-emit (L1-I). No-op when CVDIAG_BACKEND_EMITTER off.
        headers = dict(get_forwarded_headers())
        run = CvdiagBackendRun(headers)
        model_name = _model_name(request)
        run.request_ingress()
        run.agent_enter(agent_name=self.name, model_id=model_name)
        run.llm_call_start(provider="langchain", model=model_name)
        run.start_heartbeat()
        start_ns = time.monotonic_ns()
        try:
            response = await handler(request)
        except BaseException as exc:  # noqa: BLE001 - re-raised after observing
            await run.stop_heartbeat()
            run.error_caught(exc)
            run.agent_exit(terminal_outcome="err")
            raise
        await run.stop_heartbeat()
        latency_ms = int((time.monotonic_ns() - start_ns) / 1_000_000)
        run.llm_call_response(
            provider="langchain", model=model_name, latency_ms=latency_ms
        )
        run.sse_first_byte()
        run.sse_event(event_type="response", payload_size_bytes=None)
        run.agent_exit(terminal_outcome="ok")
        run.response_complete(http_status=200)
        return response


def _model_name(request: ModelRequest) -> str:
    """Best-effort model identifier off the ModelRequest (never raises)."""
    try:
        model = getattr(request, "model", None)
        for attr in ("model_name", "model", "model_id"):
            val = getattr(model, attr, None)
            if isinstance(val, str) and val:
                return val
    except Exception:  # noqa: BLE001 - instrumentation must not throw
        pass
    return "unknown"
