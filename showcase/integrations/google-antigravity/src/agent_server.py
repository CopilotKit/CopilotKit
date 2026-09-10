"""Agent server for Google Antigravity.

FastAPI app hosting one AG-UI endpoint per demo at /<name>, built with the
adapter's create_antigravity_app. The Next.js runtime maps each agent name to
its path (src/app/api/copilotkit*/route.ts).
"""

import os

# CVDIAG bootstrap — first non-stdlib import (configures logging + PB writer).
import _shared.cvdiag_bootstrap  # noqa: F401,E402

from agents._cvdiag_backend import CvdiagBackendMiddleware  # noqa: E402
from agents._header_forwarding import HeaderForwardingHTTPMiddleware  # noqa: E402

import uvicorn  # noqa: E402
from ag_ui_antigravity import create_antigravity_app  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402

from agents.registry import build_registry  # noqa: E402

load_dotenv()

AGENT_REGISTRY = build_registry()
app = create_antigravity_app(AGENT_REGISTRY)
app.title = "Google Antigravity Agent Server"


class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok", "agents": sorted(AGENT_REGISTRY)})
        return await call_next(request)


app.add_middleware(HealthMiddleware)
# Records inbound x-* headers per request. The model call is made by the Go
# harness, so these do not reach the LLM hop here; kept for CVDIAG parity and
# for any Python-side httpx call (the subagent tools).
app.add_middleware(HeaderForwardingHTTPMiddleware)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)
app.add_middleware(CvdiagBackendMiddleware)


def main():
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("agent_server:app", host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
