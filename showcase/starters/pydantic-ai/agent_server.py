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
- `/byoc_json_render`          BYOC json-render demo
- `/byoc_hashbrown`            BYOC hashbrown demo
- `/multimodal`                Multimodal attachments (image/PDF)
- `/agent_config`              Agent-config forwarded-props demo

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

from agent.agent import SalesTodosState, StateDeps, agent
from agent.open_gen_ui_agent import agent as open_gen_ui_agent
from agent.open_gen_ui_advanced_agent import agent as open_gen_ui_advanced_agent
from agent.a2ui_dynamic import EmptyState as A2UIDynamicState
from agent.a2ui_dynamic import agent as a2ui_dynamic_agent
from agent.a2ui_fixed import EmptyState as A2UIFixedState
from agent.a2ui_fixed import agent as a2ui_fixed_agent
from agent.headless_complete import EmptyState as HeadlessCompleteState
from agent.headless_complete import agent as headless_complete_agent
from agent.beautiful_chat import BeautifulChatState
from agent.beautiful_chat import agent as beautiful_chat_agent
from agent.byoc_json_render_agent import agent as byoc_json_render_agent
from agent.byoc_hashbrown_agent import agent as byoc_hashbrown_agent
from agent.multimodal_agent import agent as multimodal_agent
from agent.agent_config_agent import AgentConfigState
from agent.agent_config_agent import agent as agent_config_agent

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
app.mount(
    "/a2ui_fixed",
    a2ui_fixed_agent.to_ag_ui(deps=StateDeps(A2UIFixedState())),
)
app.mount(
    "/headless_complete",
    headless_complete_agent.to_ag_ui(deps=StateDeps(HeadlessCompleteState())),
)
app.mount(
    "/beautiful_chat",
    beautiful_chat_agent.to_ag_ui(deps=StateDeps(BeautifulChatState())),
)

# ── BYOC + multimodal + agent-config (PR #4271 demos) ────────────────
app.mount("/byoc_json_render", byoc_json_render_agent.to_ag_ui())
app.mount("/byoc_hashbrown", byoc_hashbrown_agent.to_ag_ui())
app.mount("/multimodal", multimodal_agent.to_ag_ui())
app.mount(
    "/agent_config",
    agent_config_agent.to_ag_ui(deps=StateDeps(AgentConfigState())),
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
