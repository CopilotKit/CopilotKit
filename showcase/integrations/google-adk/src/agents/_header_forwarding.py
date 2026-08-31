"""Standalone header-forwarding shim for showcase integrations.

Forward CopilotKit request-context headers (e.g. ``x-aimock-context``)
onto outbound LLM/provider HTTP calls so the locally-served aimock test
server can match the right fixture for each in-flight showcase request.

This module is a SELF-CONTAINED port of the langgraph-python reference
shim at ``copilotkit/header_propagation.py`` plus a small Starlette HTTP
middleware that extracts inbound ``x-*`` headers at request scope.

It is intentionally duplicated into every Python showcase integration
that does NOT already depend on the ``copilotkit`` SDK so each backend
has a single self-contained file it can import without adding a heavy
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
* Nothing is collected, persisted, or sent anywhere — the module only
  attaches headers to an HTTP request that the caller was already going
  to make. No telemetry, no out-of-band channel. (Diagnostic CVDIAG
  breadcrumbs ARE logged via the stdlib ``logging`` module: header
  PRESENCE plus a short value prefix only — never full header values.)
"""

from __future__ import annotations

import contextvars
import logging
import warnings
from typing import Any, Dict, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# CVDIAG: shared cross-language correlation logging. Joins with the Node
# route logs (component=route-google-adk) and the outbound-llm hook below so
# we can see which hop drops ``x-aimock-context`` on the ADK chain.
logger = logging.getLogger(__name__)


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


def _cvdiag(
    *,
    component: str,
    boundary: str,
    headers: Optional[Dict[str, str]] = None,
    hop: str = "-",
    status: str = "ok",
    error: str = "",
) -> None:
    """Emit one CVDIAG line in the shared cross-language convention.

    Never logs full header values — only a 12-char prefix of the slug.
    ``headers`` is the relevant x-* mapping for this hop (case-insensitive
    keys assumed lower-cased, as produced by ``set_forwarded_headers``).
    """
    h = headers or {}
    slug = h.get("x-aimock-context")
    run_id = h.get("x-diag-run-id")
    test_id = h.get("x-test-id")
    present = bool(slug)
    logger.info(
        "CVDIAG component=%s boundary=%s run_id=%s slug=%s header_present=%s "
        "header_value_prefix=%s hop=%s status=%s test_id=%s error=%s",
        component,
        boundary,
        run_id or "none",
        slug if present else "MISSING",
        str(present).lower(),
        (slug[:12] if present else ""),
        hop,
        status,
        test_id or "none",
        error,
    )


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
        # CVDIAG: this layer appends its breadcrumb tag to x-diag-hops so the
        # cross-language chain shows harness -> route-google-adk ->
        # backend-google-adk. Mutate the captured copy (not request.headers,
        # which is immutable) before it is stashed on the ContextVar and later
        # injected onto the outbound call.
        #
        # GATED on diagnostic-header presence: only append the breadcrumb when
        # a diagnostic header (x-diag-run-id OR x-aimock-context) is present.
        # When NEITHER is present the forwarded set is left byte-identical to
        # pre-instrumentation behavior.
        if "x-diag-run-id" in headers or "x-aimock-context" in headers:
            prev_hops = headers.get("x-diag-hops", "")
            headers["x-diag-hops"] = (
                f"{prev_hops},backend-google-adk" if prev_hops else "backend-google-adk"
            )
        set_forwarded_headers(headers)
        # set_forwarded_headers lower-cases keys; read back the canonical set
        # so the diag line reflects exactly what downstream hooks will see.
        _cvdiag(
            component="backend-google-adk",
            boundary="contextvar-capture",
            headers=get_forwarded_headers(),
            status="ok" if headers.get("x-aimock-context") else "miss",
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
        # CVDIAG: this is the PRIME-SUSPECT silent failure on the ADK chain.
        # If the Gemini SDK doesn't expose an httpx-style event_hooks target
        # within _MAX_CHAIN_DEPTH hops, the request hook never installs and
        # x-aimock-context silently never reaches aimock. Surface it as a
        # status=error CVDIAG line (NOT just warnings.warn, which is easy to
        # miss in CV-rung logs). header set is unavailable at install time, so
        # the diag line carries no slug — the error message is the signal.
        _cvdiag(
            component="backend-google-adk",
            boundary="outbound-llm",
            headers=None,
            hop="-",
            status="error",
            error=(
                f"no-event-hooks-target client_type={type(client).__name__} "
                f"max_depth={_MAX_CHAIN_DEPTH}"
            ),
        )
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
            # CVDIAG: this fires at the actual outbound Gemini request. The
            # backend hop is already recorded as `backend-google-adk` by the
            # middleware, so we do NOT append a third hop tag here — that would
            # muddle the breadcrumb. We still forward the recorded x-* headers
            # and log presence at send time (with the transport detail in the
            # `error` field, NOT the breadcrumb), proving (or disproving) that
            # the hook is both installed AND seeing the slug on the real LLM
            # call.
            #
            # GATED on diagnostic-header presence: the x-* forward loop below
            # is the shim's real job (it carries x-aimock-context to aimock)
            # and runs unconditionally — that IS pre-instrumentation behavior.
            # Only the diagnostic CVDIAG log is gated so that, absent a
            # diagnostic header, no instrumentation-only side effect fires.
            has_diag = "x-diag-run-id" in headers or "x-aimock-context" in headers
            for key, value in headers.items():
                request.headers[key] = value
            if has_diag:
                _cvdiag(
                    component="backend-google-adk",
                    boundary="outbound-llm",
                    headers=headers,
                    hop="-",
                    status="ok" if headers.get("x-aimock-context") else "miss",
                    error="transport=httpx-async",
                )

        setattr(_inject_headers_async, _HOOK_MARKER, True)
        request_hooks.append(_inject_headers_async)
    else:

        def _inject_headers(request):
            headers = get_forwarded_headers()
            # See the async hook above: no third hop tag is appended (the
            # backend hop is already `backend-google-adk`); the x-* forward
            # loop runs unconditionally as pre-instrumentation behavior; only
            # the diagnostic CVDIAG log is gated on diagnostic-header presence,
            # with the transport detail in the `error` field.
            has_diag = "x-diag-run-id" in headers or "x-aimock-context" in headers
            for key, value in headers.items():
                request.headers[key] = value
            if has_diag:
                _cvdiag(
                    component="backend-google-adk",
                    boundary="outbound-llm",
                    headers=headers,
                    hop="-",
                    status="ok" if headers.get("x-aimock-context") else "miss",
                    error="transport=httpx-sync",
                )

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
            # CVDIAG: previously a silent ``pass``. Keep swallowing the
            # exception's propagation (construction must not break), but LOG
            # it — a hook-install crash here is another way x-* forwarding
            # silently dies on the ADK chain.
            _cvdiag(
                component="backend-google-adk",
                boundary="outbound-llm",
                headers=None,
                status="error",
                error=f"sync-init-hook-install-failed {type(exc).__name__}: {exc}",
            )

    def _patched_async_init(self, *args, **kwargs):
        _orig_async_init(self, *args, **kwargs)
        try:
            install_httpx_hook(self)
        except Exception as exc:  # pragma: no cover
            _cvdiag(
                component="backend-google-adk",
                boundary="outbound-llm",
                headers=None,
                status="error",
                error=f"async-init-hook-install-failed {type(exc).__name__}: {exc}",
            )

    httpx.Client.__init__ = _patched_sync_init
    httpx.AsyncClient.__init__ = _patched_async_init
    _GLOBAL_HTTPX_PATCHED = True

    # ALSO patch aiohttp.ClientSession.request so providers that use
    # aiohttp (google-genai uses aiohttp for async streaming when available)
    # also get x-* headers injected. Without this branch the hook only
    # covers httpx-based providers (OpenAI, Anthropic, etc.).
    _install_global_aiohttp_hook()


# Module-scope sentinel preventing repeated aiohttp patching.
_GLOBAL_AIOHTTP_PATCHED = False


def _install_global_aiohttp_hook() -> None:
    """Patch ``aiohttp.ClientSession._request`` so EVERY outbound request
    has the recorded ``x-*`` headers injected.

    google-genai's ``BaseApiClient`` uses ``aiohttp.ClientSession.request``
    for async streaming calls when ``aiohttp`` is importable. Since httpx
    is bypassed entirely on that code path, we need a parallel hook here.

    Idempotent via a module-scope sentinel. Safe if aiohttp isn't installed.
    """
    global _GLOBAL_AIOHTTP_PATCHED
    if _GLOBAL_AIOHTTP_PATCHED:
        return

    try:
        import aiohttp
    except ImportError:  # pragma: no cover
        return

    _orig_request = aiohttp.ClientSession._request

    async def _patched_request(self, method, str_or_url, **kwargs):
        forwarded = get_forwarded_headers()
        # CVDIAG: google-genai uses aiohttp (NOT httpx) for async streaming
        # Gemini calls when aiohttp is importable, bypassing the httpx hook
        # entirely. This is a SECOND prime-suspect outbound surface — if the
        # CV-rung call goes out via aiohttp but the slug is empty here, the
        # contextvar didn't propagate into the aiohttp task. We do NOT append a
        # third hop tag (the backend hop is already `backend-google-adk`); the
        # transport detail goes in the log's `error` field instead.
        #
        # GATED on diagnostic-header presence: only emit the CVDIAG log when a
        # diagnostic header (x-diag-run-id OR x-aimock-context) is present. The
        # header-merge forwarding below runs unconditionally (pre-instrumentation
        # behavior), so a non-diagnostic request is byte-identical to before.
        has_diag = bool(forwarded) and (
            "x-diag-run-id" in forwarded or "x-aimock-context" in forwarded
        )
        if has_diag:
            _cvdiag(
                component="backend-google-adk",
                boundary="outbound-llm",
                headers=forwarded,
                hop="-",
                status="ok" if forwarded.get("x-aimock-context") else "miss",
                error="transport=aiohttp",
            )
        if forwarded:
            headers = kwargs.get("headers")
            if headers is None:
                kwargs["headers"] = dict(forwarded)
            else:
                # Merge: keep caller-provided headers, add x-* ones if absent.
                # Convert to a mutable mapping if necessary.
                try:
                    merged = dict(headers)
                except Exception:
                    merged = {k: v for k, v in headers}
                for k, v in forwarded.items():
                    merged.setdefault(k, v)
                kwargs["headers"] = merged
        return await _orig_request(self, method, str_or_url, **kwargs)

    aiohttp.ClientSession._request = _patched_request
    _GLOBAL_AIOHTTP_PATCHED = True
