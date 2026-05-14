"""Header propagation for forwarding x-* prefixed headers to outgoing LLM calls.

Uses Python contextvars for per-request ambient state in async FastAPI handlers.
An httpx event hook reads the ContextVar and injects headers on outgoing requests.
Matches the CopilotKit runtime's extractForwardableHeaders() behavior.
"""

import contextvars
import warnings
from typing import Dict

# Ambient per-request state for headers to forward to LLM calls
_forwarded_headers: contextvars.ContextVar[Dict[str, str]] = contextvars.ContextVar(
    "copilotkit_forwarded_headers"
)


def set_forwarded_headers(headers: Dict[str, str]) -> None:
    """Store headers to forward to outgoing LLM calls.
    Filters to x-* prefixed headers only."""
    filtered = {k.lower(): v for k, v in headers.items() if k.lower().startswith("x-")}
    _forwarded_headers.set(filtered)


def get_forwarded_headers() -> Dict[str, str]:
    """Get headers that should be forwarded to outgoing LLM calls."""
    return _forwarded_headers.get({})


def install_httpx_hook(client) -> None:
    """Append an event hook to an httpx client that injects forwarded headers.

    Works with OpenAI and Anthropic Python SDKs (both use httpx internally).
    No-op when no headers are set (demo traffic).

    Parameters
    ----------
    client : object
        An OpenAI/Anthropic client instance, or a raw httpx.Client/AsyncClient.
        For SDK clients the underlying transport lives at ``client._client``.
    """

    def _inject_headers(request):
        headers = get_forwarded_headers()
        for key, value in headers.items():
            request.headers[key] = value

    # OpenAI / Anthropic SDKs wrap an httpx client at client._client
    if hasattr(client, "_client") and hasattr(client._client, "event_hooks"):
        client._client.event_hooks["request"].append(_inject_headers)
    elif hasattr(client, "event_hooks"):
        # Raw httpx.Client / httpx.AsyncClient
        client.event_hooks["request"].append(_inject_headers)
    else:
        warnings.warn(
            f"install_httpx_hook: client of type {type(client).__name__} has no "
            "recognized event_hooks attribute; x-* headers will not be forwarded",
            stacklevel=2,
        )
