"""Agent server for Google Antigravity.

FastAPI app hosting one AG-UI endpoint per demo at /<name>, built with the
adapter's create_antigravity_app. The Next.js runtime maps each agent name to
its path (src/app/api/copilotkit*/route.ts).
"""

import os
from contextlib import asynccontextmanager

# CVDIAG bootstrap — first non-stdlib import (configures logging + PB writer).
import _shared.cvdiag_bootstrap  # noqa: F401,E402

from dotenv import load_dotenv  # noqa: E402

# ORDER-CRITICAL: .env must be loaded BEFORE any ``agents.*`` import.
# ``agents._common`` resolves ANTIGRAVITY_WORKSPACE / ANTIGRAVITY_SAVE_DIR /
# ANTIGRAVITY_MODEL / ANTIGRAVITY_REASONING_MODEL into module-level constants at
# IMPORT time, so a load_dotenv() placed after these imports would leave every
# one of them pinned to its hard-coded default.
load_dotenv()

from agents._cvdiag_backend import CvdiagBackendMiddleware  # noqa: E402
from agents._header_forwarding import HeaderForwardingHTTPMiddleware  # noqa: E402

import uvicorn  # noqa: E402
from ag_ui_antigravity import create_antigravity_app  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402

from agents._common import shared_pool  # noqa: E402
from agents.registry import build_registry  # noqa: E402
from agents.subagents import close_http_client  # noqa: E402

# @region[agent-server]
AGENT_REGISTRY = build_registry()
app = create_antigravity_app(AGENT_REGISTRY)
app.title = "Google Antigravity Agent Server"
# @endregion[agent-server]

# The adapter's create_antigravity_app already installs a lifespan that awaits
# ``agent.close()`` for every agent. An agent only shuts the harness pool down
# when it OWNS it (``_owns_pool = harness_pool is None``), and every agent here
# is handed the shared pool from ``agents._common.shared_pool()`` — so nobody
# owns it and the Go harness processes would survive shutdown. Wrap the
# adapter's lifespan rather than registering ``@app.on_event("shutdown")``:
# Starlette ignores on_startup/on_shutdown handlers entirely once an explicit
# ``lifespan=`` context is passed to the app, so an on_event hook here would
# silently never run.
_adapter_lifespan = app.router.lifespan_context


@asynccontextmanager
async def _lifespan(scoped_app):
    async with _adapter_lifespan(scoped_app):
        yield
    # Agents have released their conversations by now, so the pool has nothing
    # live left to tear down.
    try:
        await shared_pool().shutdown()
    finally:
        await close_http_client()


app.router.lifespan_context = _lifespan


class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok", "agents": sorted(AGENT_REGISTRY)})
        return await call_next(request)


app.add_middleware(HealthMiddleware)
# Records inbound x-* headers per request on a ContextVar. Nothing in this
# package installs the httpx hook that would replay them onto outbound calls
# (``install_global_httpx_hook`` is deliberately not called), and the model
# call is made by the Go harness anyway — so these headers reach neither the
# LLM hop nor the sub-agent tools' httpx calls, which stamp
# ``X-AIMock-Context`` themselves. Kept for the CVDIAG agent-hop rows.
app.add_middleware(HeaderForwardingHTTPMiddleware)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)
app.add_middleware(CvdiagBackendMiddleware)


def main():
    port = int(os.getenv("PORT", "8000"))
    # Pass the app OBJECT, not "agent_server:app": the import-string form makes
    # uvicorn import this module a second time under the name ``agent_server``
    # while it is already running as ``__main__``, which re-runs the whole
    # module body — including openai_proxy's port probe, which then raises
    # because the shim is already bound.
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
