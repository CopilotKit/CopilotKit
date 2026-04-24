"""
Agent Server for PydanticAI

FastAPI server that hosts the PydanticAI agent backend. The Next.js
CopilotKit runtime proxies requests here via the AG-UI protocol.

Layout:
- `/`                          main sales agent (all B1-ported demos)
- `/open_gen_ui`               Open Generative UI — minimal
- `/open_gen_ui_advanced`      Open Generative UI — with sandbox functions
- `/a2ui_dynamic`              Declarative Generative UI (A2UI dynamic)
- `/a2ui_fixed`                A2UI fixed-schema (flight card)
- `/headless_complete`         Headless-complete custom chat agent
- `/beautiful_chat`            Beautiful-chat flagship aliasing the main agent

Sub-paths are mounted BEFORE the root catch-all so Starlette resolves
them first. The existing single-agent behaviour at `/` is preserved for
all demos that already target the main sales agent.
"""

import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from dotenv import load_dotenv

from agents.agent import SalesTodosState, StateDeps, agent
from agents.open_gen_ui_agent import agent as open_gen_ui_agent
from agents.open_gen_ui_advanced_agent import agent as open_gen_ui_advanced_agent
from agents.a2ui_dynamic import EmptyState as A2UIDynamicState
from agents.a2ui_dynamic import agent as a2ui_dynamic_agent

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

# ── Sub-path agents — mounted BEFORE the root catch-all ──────────────
# Each demo-specific agent lives at its own sub-path. The matching
# HttpAgent URL in the corresponding TS route points to that sub-path.
app.mount("/open_gen_ui", open_gen_ui_agent.to_ag_ui())
app.mount("/open_gen_ui_advanced", open_gen_ui_advanced_agent.to_ag_ui())
app.mount(
    "/a2ui_dynamic",
    a2ui_dynamic_agent.to_ag_ui(deps=StateDeps(A2UIDynamicState())),
)

# ── Main sales agent — mounted at root (catch-all) ───────────────────
# Mounted LAST so the sub-path mounts above win for their specific paths.
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
