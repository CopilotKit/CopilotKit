"""
Agent Server for AG2

FastAPI server that hosts the AG2 agent backends.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.

Most demos share a single ConversableAgent at the root path. Demos that
require dedicated state mechanics or multi-agent topologies are mounted
as their own sub-apps at distinct paths so each demo gets its own
ContextVariables-backed state slot.
"""

import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from dotenv import load_dotenv

from agents.agent import stream as default_stream
from agents.a2ui_dynamic import a2ui_dynamic_app
from agents.a2ui_fixed import a2ui_fixed_app
from agents.agent_config_agent import agent_config_app
from agents.beautiful_chat import beautiful_chat_app
from agents.byoc_hashbrown_agent import byoc_hashbrown_app
from agents.byoc_json_render_agent import byoc_json_render_app
from agents.headless_complete import headless_complete_app
from agents.mcp_apps_agent import mcp_apps_app
from agents.multimodal_agent import multimodal_app
from agents.open_gen_ui_advanced_agent import open_gen_ui_advanced_app
from agents.open_gen_ui_agent import open_gen_ui_app
from agents.shared_state_read_write import (
    shared_state_read_write_app,
)
from agents.subagents import subagents_app
from agents.interrupt_agent import interrupt_app
from agents.tool_rendering_reasoning_chain import (
    tool_rendering_reasoning_chain_app,
)

load_dotenv()

app = FastAPI(title="AG2 Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# A plain `@app.get("/health")` decorator is shadowed by the subsequent
# `app.mount("/", ...)` call: Starlette's Mount at "/" matches every path
# (including /health) and the decorated route never fires. Middleware runs
# above the routing layer, so the health endpoint stays reachable regardless
# of what the framework-specific AG-UI adapter mounts at root.
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


# Mount per-demo sub-apps FIRST. Starlette's router resolves mounts in
# registration order; the catch-all `/` mount below shadows everything
# under it, so the named mounts must come first.
app.mount("/shared-state-read-write", shared_state_read_write_app)
app.mount("/subagents", subagents_app)
app.mount("/headless-complete", headless_complete_app)
app.mount("/declarative-gen-ui", a2ui_dynamic_app)
app.mount("/a2ui-fixed-schema", a2ui_fixed_app)
app.mount("/beautiful-chat", beautiful_chat_app)
app.mount("/mcp-apps", mcp_apps_app)
# IMPORTANT: mount /open-gen-ui-advanced BEFORE /open-gen-ui — Starlette
# resolves mounts via prefix matching in registration order, so the shorter
# prefix "/open-gen-ui" would shadow "/open-gen-ui-advanced" if it came first.
app.mount("/open-gen-ui-advanced", open_gen_ui_advanced_app)
app.mount("/open-gen-ui", open_gen_ui_app)
app.mount(
    "/tool-rendering-reasoning-chain",
    tool_rendering_reasoning_chain_app,
)
app.mount("/agent-config", agent_config_app)
app.mount("/multimodal", multimodal_app)
app.mount("/byoc-hashbrown", byoc_hashbrown_app)
app.mount("/byoc-json-render", byoc_json_render_app)

# Interrupt-adapted scheduling agent. Shared by gen-ui-interrupt and
# interrupt-headless demos — backend has tools=[], the frontend provides
# `schedule_meeting` via `useFrontendTool` with an async Promise handler.
app.mount("/interrupt-adapted", interrupt_app)


# Mount the default AG2 AG-UI endpoint at the root.
# `app.mount("/", ...)` is a catch-all Mount that shadows any later route
# decorators, which is why /health is served by HealthMiddleware above
# rather than a `@app.get("/health")` handler registered here.
app.mount("/", default_stream.build_asgi())


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
