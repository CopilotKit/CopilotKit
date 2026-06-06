"""Standalone header-forwarding shim for showcase integrations.

Forward CopilotKit request-context headers (e.g. ``x-aimock-context``)
onto outbound LLM/provider HTTP calls so the locally-served aimock test
server can match the right fixture for each in-flight showcase request.

This module is a SELF-CONTAINED port of the langgraph-python reference
shim at ``copilotkit/header_propagation.py`` plus a small Starlette HTTP
middleware that extracts inbound ``x-*`` headers at request scope.

It is intentionally duplicated into every Python showcase integration
that does NOT already depend on the ``copilotkit`` SDK so each backend
has a single ~120-line file it can import without adding a heavy
``copilotkit`` (langchain-pulling) dependency.

What this module does
---------------------
Three things, kept deliberately small:

1. ``HeaderForwardingHTTPMiddleware`` — a Starlette/FastAPI HTTP
   middleware that, on every inbound request, extracts ``x-*`` prefixed
   headers and stashes them on a per-request ``contextvars.ContextVar``.
2. ``install_httpx_hook(client)`` — attaches an httpx request event hook
   to the given LLM client's underlying httpx client (walking the
   ``._client`` chain that modern provider SDKs wrap their httpx client
   behind). The hook copies the recorded headers onto outbound requests.
3. ``set_forwarded_headers`` / ``get_forwarded_headers`` — direct
   ContextVar accessors for integrations that need to populate the
   header set from a non-HTTP source (e.g. LangGraph's RunnableConfig
   ``configurable`` channel).

Scope and limits
----------------
* Only ``x-*`` prefixed headers are forwarded. ``authorization``,
  ``content-type``, and any other non-``x-*`` headers are dropped.
* Nothing is collected, persisted, logged, or sent anywhere — the module
  only attaches headers to an HTTP request that the caller was already
  going to make. No telemetry, no out-of-band channel.
"""

from __future__ import annotations

import contextvars
import logging
import warnings
from typing import Any, Dict, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

# CVDIAG correlation-header instrumentation tag for this integration. Each
# showcase backend that copies this shim sets a distinct framework tag so the
# CVDIAG breadcrumb trail identifies which backend captured/forwarded headers.
_CVDIAG_FRAMEWORK = "ag2"

# Correlation headers carried end-to-end through the showcase request chain.
_DIAG_RUN_ID_HEADER = "x-diag-run-id"
_DIAG_HOPS_HEADER = "x-diag-hops"
_AIMOCK_CONTEXT_HEADER = "x-aimock-context"
_TEST_ID_HEADER = "x-test-id"


def _cvdiag(
    boundary: str,
    headers: Dict[str, str],
    *,
    status: str,
    hop: object = "-",
    error: str = "",
) -> None:
    """Emit a single standardized CVDIAG breadcrumb line.

    Logs ONLY header presence + a short value prefix (never full header
    values). ``headers`` is the lowercased ``x-*`` header mapping for the
    current request context.
    """
    slug = headers.get(_AIMOCK_CONTEXT_HEADER)
    run_id = headers.get(_DIAG_RUN_ID_HEADER, "none")
    test_id = headers.get(_TEST_ID_HEADER, "none")
    present = slug is not None
    prefix = (slug or "")[:12]
    logger.info(
        "CVDIAG component=backend-%s boundary=%s run_id=%s slug=%s "
        "header_present=%s header_value_prefix=%s hop=%s status=%s "
        "test_id=%s error=%s",
        _CVDIAG_FRAMEWORK,
        boundary,
        run_id,
        slug if present else "MISSING",
        "true" if present else "false",
        prefix,
        hop,
        status,
        test_id,
        error,
    )


# Per-request storage for the headers the application has asked to forward
# onto outbound LLM/provider calls.
_forwarded_headers: contextvars.ContextVar[Dict[str, str]] = contextvars.ContextVar(
    "copilotkit_forwarded_headers"
)

# Marker used to identify hooks we have already installed so the install
# call is idempotent across repeated invocations on the same client.
_HOOK_MARKER = "_copilotkit_forwarded_header_hook"

# Bound on how deep we'll walk a ``._client`` chain looking for event_hooks.
# Modern provider SDKs (OpenAI, Anthropic, pydantic-ai wrappers, agno's
# OpenAIChat, strands' OpenAIModel) wrap their httpx client behind 2-4
# layers of ``._client`` indirection; 5 hops is enough headroom without
# risking pathological loops.
_MAX_CHAIN_DEPTH = 5


def set_forwarded_headers(headers: Dict[str, str]) -> None:
    """Record headers to forward onto outbound LLM/provider calls.

    Only ``x-*`` prefixed headers are kept; everything else is dropped.
    """
    filtered = {k.lower(): v for k, v in headers.items() if k.lower().startswith("x-")}
    _forwarded_headers.set(filtered)


def get_forwarded_headers() -> Dict[str, str]:
    """Return the headers recorded for the current request context."""
    return _forwarded_headers.get({})


class HeaderForwardingHTTPMiddleware(BaseHTTPMiddleware):
    """Starlette/FastAPI middleware that captures inbound ``x-*`` headers.

    On every inbound HTTP request, copies all ``x-*`` prefixed headers
    onto the per-request ContextVar so any outbound httpx call made
    inside the request scope (the LLM call hop 2) sees them via
    ``get_forwarded_headers()`` and the installed httpx event hook.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        headers = {
            k: v for k, v in request.headers.items() if k.lower().startswith("x-")
        }
        set_forwarded_headers(headers)
        captured = {k.lower(): v for k, v in headers.items()}
        _cvdiag(
            "contextvar-capture",
            captured,
            status="ok" if _AIMOCK_CONTEXT_HEADER in captured else "miss",
        )
        return await call_next(request)


def _find_event_hooks_target(client: Any) -> Optional[Any]:
    """Walk ``._client`` chain looking for the first httpx-style event_hooks.

    Returns the target object, or ``None`` if not found within
    ``_MAX_CHAIN_DEPTH`` hops.
    """
    current = client
    for _ in range(_MAX_CHAIN_DEPTH + 1):
        if current is None:
            return None
        if hasattr(current, "event_hooks"):
            return current
        nxt = getattr(current, "_client", None)
        if nxt is current or nxt is None:
            return None
        current = nxt
    return None


def _is_async_httpx_target(target: Any) -> bool:
    """Best-effort detection: is this an httpx async client?"""
    try:
        import httpx

        if isinstance(target, httpx.AsyncClient):
            return True
        if isinstance(target, httpx.Client):
            return False
    except ImportError:  # pragma: no cover
        pass

    # Fall back to exact class-name match for wrapped/duck-typed clients.
    for cls in type(target).__mro__:
        if cls.__name__ == "AsyncClient":
            return True
    return False


def _inject_diag_hop(request: Any, headers: Dict[str, str]) -> None:
    """Append this backend's hop tag to ``x-diag-hops`` on the outbound
    request and emit the ``outbound-llm`` CVDIAG breadcrumb.

    ``x-diag-hops`` is a comma-separated trail of the backends that touched
    the request; appending ``backend-<framework>`` here records that this
    integration forwarded the correlation headers onto the LLM/provider
    call. ``x-diag-run-id`` is carried verbatim (already copied above via
    the ``headers`` loop) the same way ``x-aimock-context`` is.

    GATED on diagnostic-header presence: the breadcrumb append and the
    outbound CVDIAG log fire ONLY when the forwarded headers carry a
    diagnostic header (``x-diag-run-id`` OR ``x-aimock-context``). When
    NEITHER is present this is a no-op, so the outbound request is
    byte-identical to pre-instrumentation behavior.
    """
    if _DIAG_RUN_ID_HEADER not in headers and _AIMOCK_CONTEXT_HEADER not in headers:
        return

    hop_tag = f"backend-{_CVDIAG_FRAMEWORK}"
    existing = headers.get(_DIAG_HOPS_HEADER, "")
    trail = [h for h in (existing.split(",") if existing else []) if h]
    trail.append(hop_tag)
    new_hops = ",".join(trail)
    request.headers[_DIAG_HOPS_HEADER] = new_hops

    _cvdiag(
        "outbound-llm",
        headers,
        status="ok" if _AIMOCK_CONTEXT_HEADER in headers else "miss",
        hop=len(trail),
    )


def install_httpx_hook(client: Any) -> None:
    """Attach an httpx request event hook to ``client``'s httpx client.

    Walks the ``._client`` chain to find the first object with an
    ``event_hooks`` mapping, then appends a request hook that copies the
    ContextVar-recorded headers onto each outbound request.

    Works with OpenAI / Anthropic / pydantic-ai / agno / strands client
    wrappers (all wrap httpx internally), as well as raw
    ``httpx.Client`` / ``httpx.AsyncClient`` instances.

    Idempotent: a marker attribute on the installed callable prevents
    double-installation on the same target.
    """
    target = _find_event_hooks_target(client)

    if target is None:
        warnings.warn(
            f"install_httpx_hook: client of type {type(client).__name__} has no "
            "recognized event_hooks attribute; x-* headers will not be forwarded",
            stacklevel=2,
        )
        return

    request_hooks = target.event_hooks.get("request", [])

    # Idempotency: don't double-install on the same target.
    for existing in request_hooks:
        if getattr(existing, _HOOK_MARKER, False):
            return

    is_async = _is_async_httpx_target(target)

    if is_async:

        async def _inject_headers_async(request):
            headers = get_forwarded_headers()
            for key, value in headers.items():
                request.headers[key] = value
            _inject_diag_hop(request, headers)

        setattr(_inject_headers_async, _HOOK_MARKER, True)
        request_hooks.append(_inject_headers_async)
    else:

        def _inject_headers(request):
            headers = get_forwarded_headers()
            for key, value in headers.items():
                request.headers[key] = value
            _inject_diag_hop(request, headers)

        setattr(_inject_headers, _HOOK_MARKER, True)
        request_hooks.append(_inject_headers)

    target.event_hooks["request"] = request_hooks


# Module-scope sentinel preventing repeated global patching.
_GLOBAL_HTTPX_PATCHED = False


def install_global_httpx_hook() -> None:
    """Patch ``httpx.Client`` / ``httpx.AsyncClient`` so EVERY future
    instance auto-attaches the forwarded-header hook on construction.

    Use this when the LLM client is buried behind opaque framework
    machinery (AG2's ``ConversableAgent`` constructs OpenAI clients
    lazily, CrewAI uses litellm which constructs httpx clients per-call,
    etc.) and there is no single client instance to call
    :func:`install_httpx_hook` on at startup.

    Safe to call at import time. Idempotent: a module-scope sentinel
    prevents repeated patching, and the per-instance idempotency check
    in :func:`install_httpx_hook` prevents double-hooking on each new
    client. Pre-existing ``httpx.Client`` instances are not retroactively
    hooked — only those constructed AFTER this call.
    """
    global _GLOBAL_HTTPX_PATCHED
    if _GLOBAL_HTTPX_PATCHED:
        return

    try:
        import httpx
    except ImportError:  # pragma: no cover
        return

    _orig_sync_init = httpx.Client.__init__
    _orig_async_init = httpx.AsyncClient.__init__

    def _patched_sync_init(self, *args, **kwargs):
        _orig_sync_init(self, *args, **kwargs)
        try:
            install_httpx_hook(self)
        except Exception as exc:  # pragma: no cover - never break client construction
            _cvdiag(
                "hook-install",
                {},
                status="error",
                error=f"{type(exc).__name__}: {exc}"[:80],
            )

    def _patched_async_init(self, *args, **kwargs):
        _orig_async_init(self, *args, **kwargs)
        try:
            install_httpx_hook(self)
        except Exception as exc:  # pragma: no cover
            _cvdiag(
                "hook-install",
                {},
                status="error",
                error=f"{type(exc).__name__}: {exc}"[:80],
            )

    httpx.Client.__init__ = _patched_sync_init
    httpx.AsyncClient.__init__ = _patched_async_init
    _GLOBAL_HTTPX_PATCHED = True


# Module-scope sentinel preventing repeated executor patching.
_EXECUTOR_CTXVAR_PATCHED = False


def install_executor_contextvar_propagation() -> None:
    """Patch ``asyncio.events.AbstractEventLoop.run_in_executor`` so the
    parent task's ContextVars are propagated into the executor thread.

    Why this exists
    ---------------
    autogen's ``ConversableAgent.a_generate_oai_reply`` dispatches the
    underlying (sync) OpenAI/LiteLLM call onto the default thread pool
    via ``loop.run_in_executor(None, functools.partial(...))``. The stock
    ``run_in_executor`` does NOT copy the caller's :pep:`567` context to
    the worker thread — so the :class:`HeaderForwardingHTTPMiddleware`
    ContextVar (set on the inbound request task) is empty inside the
    executor, and our outbound httpx hook sees no headers to forward.

    ``asyncio.to_thread`` (Python 3.9+) does copy context the right way;
    this patch makes plain ``run_in_executor`` behave the same. It only
    affects functions submitted via ``run_in_executor`` — coroutines and
    other constructs are unaffected.

    Safe to call at import time. Idempotent via a module-scope sentinel.
    Pre-existing event-loop instances inherit the patch because
    ``run_in_executor`` is defined on ``BaseEventLoop`` and looked up
    per-call via normal method resolution.
    """
    global _EXECUTOR_CTXVAR_PATCHED
    if _EXECUTOR_CTXVAR_PATCHED:
        return

    import asyncio.base_events as _base_events

    _orig_run_in_executor = _base_events.BaseEventLoop.run_in_executor

    def _patched_run_in_executor(self, executor, func, *args):
        # Capture the CURRENT task's context at submit time, then run the
        # submitted callable inside that context on the worker thread.
        ctx = contextvars.copy_context()

        def _ctx_wrapper(*a, **kw):
            return ctx.run(func, *a, **kw)

        # Preserve __name__/__qualname__ for nicer tracebacks where possible.
        try:
            _ctx_wrapper.__wrapped__ = func  # type: ignore[attr-defined]
        except Exception:  # pragma: no cover
            pass

        return _orig_run_in_executor(self, executor, _ctx_wrapper, *args)

    _base_events.BaseEventLoop.run_in_executor = _patched_run_in_executor
    _EXECUTOR_CTXVAR_PATCHED = True
