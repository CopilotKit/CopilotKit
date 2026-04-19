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
# Upstream issue: not yet filed against strands-agents. Once strands fixes
# the issue (or makes instrumentation opt-in), this block can be removed.
from opentelemetry.instrumentation.threading import (  # noqa: E402  (must precede ag_ui_strands / strands imports)
    ThreadingInstrumentor as _ThreadingInstrumentor,
)


def _disabled_instrument(self, *args, **kwargs):
    """No-op replacement for ``ThreadingInstrumentor.instrument``.

    Returns ``self`` so fluent callers (``ThreadingInstrumentor().instrument().uninstrument()``)
    don't raise ``AttributeError: 'NoneType' object has no attribute ...``.
    """
    return self


_ThreadingInstrumentor.instrument = _disabled_instrument  # type: ignore[method-assign]

# Runtime assertion: ensure the patch is actually in effect. If a future
# refactor accidentally imports strands/ag_ui_strands above this line, the
# Tracer may have already been constructed with the original implementation.
# The marker attribute check confirms our replacement is what's installed.
assert _ThreadingInstrumentor.instrument is _disabled_instrument, (
    "ThreadingInstrumentor.instrument patch was not applied — "
    "check import order in agent_server.py"
)

import uvicorn  # noqa: E402  (kept after patch for consistent import-ordering policy)
from dotenv import load_dotenv  # noqa: E402

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


@app.get("/health")
async def health():
    return {"status": "ok"}


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
