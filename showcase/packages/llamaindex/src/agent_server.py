"""
Agent Server for LlamaIndex

FastAPI server that hosts the LlamaIndex agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.

LlamaIndex's get_ag_ui_workflow_router() returns a FastAPI APIRouter that
implements the AG-UI protocol, so we just include it directly.
"""

import os
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from agents.agent import agent_router
from agents.a2ui_dynamic import a2ui_dynamic_router
from agents.a2ui_fixed import a2ui_fixed_router
from agents.agent_config_agent import agent_config_router
from agents.byoc_hashbrown_agent import byoc_hashbrown_router
from agents.byoc_json_render_agent import byoc_json_render_router
from agents.mcp_apps_agent import mcp_apps_router
from agents.multimodal_agent import multimodal_router
from agents.open_gen_ui_advanced_agent import open_gen_ui_advanced_router
from agents.open_gen_ui_agent import open_gen_ui_router
from agents.reasoning_agent import reasoning_router
from agents.tool_rendering_reasoning_chain_agent import (
    tool_rendering_reasoning_chain_router,
)

load_dotenv()

app = FastAPI(title="LlamaIndex Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# `agent_router` can (now or in the future) register a catch-all at "/" that
# would shadow a `@app.get("/health")` decorator. Middleware runs above the
# routing layer, so /health stays reachable regardless.
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

app.include_router(agent_router)

# Dedicated routers for demos that need distinct system prompts / tool sets.
# Each is mounted at its own subpath so the Next.js runtime can route specific
# agent IDs to the right backend via HttpAgent URL configuration.
app.include_router(reasoning_router, prefix="/reasoning")
app.include_router(
    tool_rendering_reasoning_chain_router,
    prefix="/tool-rendering-reasoning-chain",
)
app.include_router(a2ui_dynamic_router, prefix="/a2ui-dynamic")
app.include_router(a2ui_fixed_router, prefix="/a2ui-fixed")
app.include_router(byoc_json_render_router, prefix="/byoc-json-render")
app.include_router(byoc_hashbrown_router, prefix="/byoc-hashbrown")
app.include_router(agent_config_router, prefix="/agent-config")
app.include_router(multimodal_router, prefix="/multimodal")
app.include_router(open_gen_ui_router, prefix="/open-gen-ui")
app.include_router(
    open_gen_ui_advanced_router, prefix="/open-gen-ui-advanced"
)
app.include_router(mcp_apps_router, prefix="/mcp-apps")


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
