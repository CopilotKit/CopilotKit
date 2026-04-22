"""
Agent Server for PydanticAI

FastAPI server that hosts the PydanticAI agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from dotenv import load_dotenv

from agents.agent import SalesTodosState, StateDeps, agent

load_dotenv()

app = FastAPI(title="PydanticAI Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# `app.mount("/", ag_ui_app)` installs a Starlette Mount at the root that
# matches every path (including /health). A plain `@app.get("/health")`
# decorator registered before the mount was still shadowed in practice because
# Mount at "/" is a prefix match rather than an exact one. Middleware runs
# above the routing layer, which guarantees /health stays reachable.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the PydanticAI AG-UI endpoint at the root
ag_ui_app = agent.to_ag_ui(deps=StateDeps(SalesTodosState()))
app.mount("/", ag_ui_app)


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
