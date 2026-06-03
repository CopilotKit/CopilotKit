"""Forward CopilotKit request-context headers onto outbound LLM/provider HTTP calls
so downstream services (e.g. the aimock test server, proxies, request routing /
fixture-matching infrastructure) can correlate the outbound provider call with the
original inbound request.

What this module does
---------------------
On each inbound request the application stores a small set of ``x-*`` prefixed
headers (for example ``x-aimock-context``, ``x-aimock-session``, ``x-request-id``,
``x-trace-id``) on a per-request ``contextvars.ContextVar``. When the application
later makes an outbound HTTP call to an LLM provider (OpenAI, Anthropic, or any
client that wraps ``httpx``), an httpx request event hook reads that ContextVar
and copies those same headers onto the outbound request so downstream services
can correlate the two.

This is plain header propagation, not data collection. Scope and limits:

* Only headers the application itself set on the request context via
  ``set_forwarded_headers`` are forwarded. The module never reads request
  bodies, cookies, user data, credentials, or anything off the inbound
  request beyond the headers explicitly handed to it.
* Only ``x-*`` prefixed headers pass the filter; ``authorization``,
  ``content-type``, and any other non ``x-*`` headers are dropped.
* Nothing is collected, persisted, logged, or sent anywhere by this module
  itself — it only attaches headers to an HTTP request that the caller was
  already going to make. There is no telemetry, no out-of-band channel, and
  no end-user data flow.

Mechanics
---------
``install_httpx_hook`` does two small things:

1. It walks the ``._client`` chain on the given object (modern provider SDKs
   wrap their httpx client behind several layers of ``._client``) to find the
   first object that exposes an httpx-style ``event_hooks`` mapping.
2. It attaches a request event hook to that mapping. The hook flavor matches
   the client: an async coroutine hook for ``httpx.AsyncClient`` (httpx awaits
   request hooks on async clients), and a plain sync hook for ``httpx.Client``.
   Installation is idempotent via a marker attribute on the installed callable.

This mirrors the CopilotKit runtime's ``extractForwardableHeaders()`` behavior
on the Node side so the Python SDK forwards the same set of context headers.
"""

import contextvars
import warnings
from typing import Any, Dict, Optional

# Per-request storage for the set of headers the application has asked to forward
# onto outbound LLM/provider calls (populated by ``set_forwarded_headers``).
_forwarded_headers: contextvars.ContextVar[Dict[str, str]] = contextvars.ContextVar(
    "copilotkit_forwarded_headers"
)

# Marker used to identify hooks we have already installed, so install_httpx_hook
# is idempotent across repeated calls on the same client.
_HOOK_MARKER = "_copilotkit_forwarded_header_hook"

# Bound on how deep we'll walk a ``._client`` chain looking for event_hooks.
# The modern OpenAI SDK shape is:
#   ChatOpenAI.client -> Completions/AsyncCompletions resource
#     -> ._client = openai.OpenAI / AsyncOpenAI  (no event_hooks)
#     -> ._client._client = httpx wrapper        (HAS event_hooks)
# 5 hops is plenty of headroom for similar SDKs without risking pathological loops.
_MAX_CHAIN_DEPTH = 5


def set_forwarded_headers(headers: Dict[str, str]) -> None:
    """Record the set of headers to forward onto outbound LLM/provider calls
    made later in this request context.

    Only ``x-*`` prefixed headers are kept; everything else is dropped.
    """
    filtered = {k.lower(): v for k, v in headers.items() if k.lower().startswith("x-")}
    _forwarded_headers.set(filtered)


def get_forwarded_headers() -> Dict[str, str]:
    """Return the headers the application has asked to forward onto outbound
    LLM/provider calls in the current request context."""
    return _forwarded_headers.get({})


def _find_event_hooks_target(client: Any) -> Optional[Any]:
    """Walk the ``._client`` chain looking for the first object that exposes
    an httpx-style ``event_hooks`` mapping.

    Returns the target object, or ``None`` if no such object is found within
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


def install_httpx_hook(client: Any) -> None:
    """Attach a request event hook to ``client``'s underlying httpx client so
    that headers recorded via ``set_forwarded_headers`` are copied onto
    outbound requests.

    Works with OpenAI and Anthropic Python SDKs (both wrap httpx internally,
    sometimes via several layers of ``._client`` indirection), as well as raw
    ``httpx.Client`` / ``httpx.AsyncClient`` instances.

    For ``httpx.AsyncClient`` an async hook is attached (httpx awaits request
    hooks on async clients); for sync clients a sync hook is attached.

    Idempotent: a marker attribute on the installed callable prevents double
    installation on the same target.

    Parameters
    ----------
    client : object
        An OpenAI/Anthropic client instance, or a raw httpx.Client/AsyncClient.
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

    # Choose sync vs async hook flavor based on the target class.
    # httpx.AsyncClient awaits request hooks; a sync hook returning None would
    # raise "TypeError: object NoneType can't be used in 'await' expression",
    # which surfaces as APIConnectionError to the caller.
    is_async = _is_async_httpx_target(target)

    if is_async:

        async def _inject_headers_async(request):
            headers = get_forwarded_headers()
            for key, value in headers.items():
                request.headers[key] = value

        setattr(_inject_headers_async, _HOOK_MARKER, True)
        request_hooks.append(_inject_headers_async)
    else:

        def _inject_headers(request):
            headers = get_forwarded_headers()
            for key, value in headers.items():
                request.headers[key] = value

        setattr(_inject_headers, _HOOK_MARKER, True)
        request_hooks.append(_inject_headers)

    # In case ``event_hooks`` returned a fresh list (defensive), make sure the
    # mutation is reflected on the target.
    target.event_hooks["request"] = request_hooks


def _is_async_httpx_target(target: Any) -> bool:
    """Best-effort detection: is this object an httpx async client?

    Tries ``isinstance`` against the real ``httpx.AsyncClient`` / ``httpx.Client``
    first (the authoritative answer for real clients). If httpx is not
    importable, or the target is neither of those (e.g. a wrapped or
    duck-typed client used in tests), falls back to an EXACT MRO class-name
    match against ``"AsyncClient"``. Avoids a broad ``startswith("Async")``
    check, which would misclassify a sync client whose MRO happens to
    include an ``Async*``-named base (e.g. ``AsyncContextManager``) as
    async — attaching an async hook that httpx calls synchronously would
    leave the coroutine unawaited and the forwarded headers would not be
    attached to the outbound request.
    """
    try:
        import httpx  # local import keeps httpx an optional concern at import time

        if isinstance(target, httpx.AsyncClient):
            return True
        if isinstance(target, httpx.Client):
            return False
    except (
        ImportError
    ):  # pragma: no cover - httpx should always be importable in practice
        pass

    # Fall back to exact class-name match for wrapped/duck-typed clients.
    for cls in type(target).__mro__:
        if cls.__name__ == "AsyncClient":
            return True
    return False
