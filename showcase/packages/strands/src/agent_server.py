"""
Agent Server for AWS Strands

FastAPI server that hosts the Strands agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.

IMPORTANT: Do NOT import ``ag_ui_strands`` or ``strands`` (directly or
transitively via ``agents.agent``) above the ``_disabled_instrument`` patch
below. The patch MUST be installed before strands' Tracer is constructed,
otherwise ``ThreadingInstrumentor().instrument()`` runs with the unpatched
implementation and causes recursive ThreadPoolExecutor wrapping.
"""

import os
import sys

# HACK: strands-agents (observed on 1.35.0, requirements.txt floors at 1.15.0)
# unconditionally calls ``ThreadingInstrumentor().instrument()`` when its
# Tracer is constructed (strands/telemetry/tracer.py). In combination with
# strands' async model client dispatching work onto ThreadPoolExecutor, this
# wraps ThreadPoolExecutor.submit in a way that re-enters itself recursively,
# producing ``RecursionError: maximum recursion depth exceeded`` during
# tool-rendering requests and surfacing as an OpenAI APIConnectionError.
#
# Disabling the autoload env var (OTEL_PYTHON_DISABLED_INSTRUMENTATIONS)
# does not help because strands imports and instruments the class
# directly, bypassing the entry_point-based autoloader.
#
# Neutralize the instrument() call before strands imports the module.
# Remove this block once ``strands-agents >= X.Y.Z`` is pinned in
# requirements.txt, where X.Y.Z is the version that makes OTel
# instrumentation opt-in (not yet released as of strands-agents 1.35.0).
from opentelemetry.instrumentation.threading import (  # noqa: E402  (must precede ag_ui_strands / strands imports)
    ThreadingInstrumentor as _ThreadingInstrumentor,
)

# Import-order guard: if ``strands`` was already imported above this line
# (directly or transitively), the Tracer may have been constructed with
# the original ``instrument`` — and patching the class now has no effect
# on the already-wrapped ThreadPoolExecutor. Fail loudly at import rather
# than silently recursing at request time.
#
# NOTE: these guards are implemented as ``if not ...: raise RuntimeError``
# rather than ``assert`` on purpose. ``assert`` statements are stripped
# when Python runs with ``-O`` (some Docker base images and optimized
# CPython builds do this), which would silently re-expose the recursion
# bug. Using an explicit raise keeps the guard active under ``-O``.
def _assert_strands_not_preimported() -> None:
    """Raise RuntimeError if ``strands`` was imported before this patch ran.

    Extracted to a named function so tests can monkey-patch it cleanly
    (rather than having to regex-neutralize an inline assert in the source).
    """
    if "strands" in sys.modules:
        raise RuntimeError(
            "strands imported before OTel patch applied — "
            "remove any strands / ag_ui_strands import that precedes this line in agent_server.py"
        )


_assert_strands_not_preimported()


def _disabled_instrument(self, *args, **kwargs):
    """No-op replacement for ``ThreadingInstrumentor.instrument``.

    Returns ``self`` so fluent callers (``ThreadingInstrumentor().instrument().uninstrument()``)
    don't raise ``AttributeError: 'NoneType' object has no attribute ...``.
    """
    return self


_ThreadingInstrumentor.instrument = _disabled_instrument  # type: ignore[method-assign]


def _assert_instrumentor_patched() -> None:
    """Raise RuntimeError if the ThreadingInstrumentor patch is not in effect.

    Extracted to a named function for the same reason as
    ``_assert_strands_not_preimported`` — survives ``python -O`` and is
    cleanly monkey-patchable from tests.
    """
    if _ThreadingInstrumentor.instrument is not _disabled_instrument:
        raise RuntimeError(
            "ThreadingInstrumentor.instrument patch was not applied — "
            "check import order in agent_server.py"
        )


_assert_instrumentor_patched()

import uvicorn  # noqa: E402  (kept after patch for consistent import-ordering policy)
from dotenv import load_dotenv  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402

from ag_ui_strands import create_strands_app  # noqa: E402  (must follow instrumentor patch)
from agents.agent import build_showcase_agent  # noqa: E402  (must follow instrumentor patch)

load_dotenv()

# Build the agent via factory so import-time failures are localized and
# testable. Any env-var / model-init / hook-patching errors surface here,
# not at arbitrary module-import time.
agui_agent = build_showcase_agent()

# Create the FastAPI app from the AG-UI Strands integration
agent_path = os.getenv("AGENT_PATH", "/")
app = create_strands_app(agui_agent, agent_path)


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# `create_strands_app(..., agent_path="/")` installs a catch-all at the root
# that shadows any later `@app.get("/health")` decorator. Middleware runs
# above the routing layer, so /health stays reachable.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "agent_server:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )


if __name__ == "__main__":
    main()
