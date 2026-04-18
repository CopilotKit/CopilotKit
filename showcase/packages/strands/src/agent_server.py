"""
Agent Server for AWS Strands

FastAPI server that hosts the Strands agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

import os
import uvicorn
from dotenv import load_dotenv

# HACK: strands-agents 1.35.0 unconditionally calls
# `ThreadingInstrumentor().instrument()` when its Tracer is constructed
# (strands/telemetry/tracer.py). In combination with strands' async model
# client dispatching work onto ThreadPoolExecutor, this wraps
# ThreadPoolExecutor.submit in a way that re-enters itself recursively,
# producing `RecursionError: maximum recursion depth exceeded` during
# tool-rendering requests and surfacing as an OpenAI APIConnectionError.
#
# Disabling the autoload env var (OTEL_PYTHON_DISABLED_INSTRUMENTATIONS)
# does not help because strands imports and instruments the class
# directly, bypassing the entry_point-based autoloader.
#
# Neutralize the instrument() call before strands imports the module.
# Once strands fixes the upstream issue (or makes instrumentation opt-in),
# this block can be removed.
from opentelemetry.instrumentation.threading import ThreadingInstrumentor as _ThreadingInstrumentor  # noqa: E402

_ThreadingInstrumentor.instrument = lambda self, *args, **kwargs: None  # type: ignore[method-assign]

from ag_ui_strands import create_strands_app  # noqa: E402
from agents.agent import agui_agent  # noqa: E402

load_dotenv()

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
