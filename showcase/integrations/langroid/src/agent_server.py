"""
Agent Server for Langroid

FastAPI server that hosts the Langroid agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.

Langroid does not have a native AG-UI adapter, so we implement a custom
SSE endpoint that translates between Langroid's ChatAgent and the AG-UI
event stream.
"""

import os
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from dotenv import load_dotenv

from agents.agui_adapter import handle_run
from agents.a2ui_fixed_agent import handle_run as handle_a2ui_fixed_schema
from agents.byoc_hashbrown_agent import handle_run as handle_byoc_hashbrown
from agents.byoc_json_render_agent import handle_run as handle_byoc_json_render
from agents.mcp_apps_agent import handle_run as handle_mcp_apps
from agents.multimodal_agent import handle_run as handle_multimodal
from agents.shared_state_read_write import (
    handle_run as handle_shared_state_read_write,
)
from agents.subagents import handle_run as handle_subagents

load_dotenv()

app = FastAPI(title="Langroid Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# Applied uniformly across every showcase FastAPI agent server so /health
# remains reachable even if future changes introduce a catch-all mount at "/".
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


@app.post("/")
async def run_agent(request: Request):
    """AG-UI /run endpoint — streams SSE events."""
    return await handle_run(request)


# Per-demo endpoints for cells that need state-aware behavior the unified
# agent does not provide. Each handler implements its own AG-UI SSE
# pipeline (RUN_STARTED / STATE_SNAPSHOT / TEXT_* / TOOL_CALL_* / RUN_FINISHED)
# so it can read RunAgentInput.state and emit fresh snapshots when its
# tools mutate shared state. The Next.js runtime routes the demo's
# CopilotKit calls to /api/copilotkit-<slug>, which proxies to these
# endpoints via per-demo HttpAgent instances.


@app.post("/shared-state-read-write")
async def run_shared_state_read_write(request: Request):
    """Shared State (Read + Write) demo endpoint.

    The UI writes ``preferences`` into agent state via ``agent.setState``;
    the handler injects them into the system prompt every turn. The agent
    writes ``notes`` via the ``set_notes`` tool; the handler emits a
    STATE_SNAPSHOT so the UI re-renders.
    """
    return await handle_shared_state_read_write(request)


@app.post("/subagents")
async def run_subagents(request: Request):
    """Sub-Agents demo endpoint.

    A supervisor LLM delegates to research / writing / critique sub-agents
    via tool calls. Each delegation appends a Delegation entry to
    ``state["delegations"]`` (running -> completed/failed) and emits a
    STATE_SNAPSHOT so the UI's live delegation log updates.
    """
    return await handle_subagents(request)


@app.post("/multimodal")
async def run_multimodal(request: Request):
    """Multimodal demo endpoint — vision-capable (gpt-4o).

    Forwards image attachments to the model natively; flattens PDFs to
    text via pypdf so the model can read them without needing file-part
    support on the OpenAI API side.
    """
    return await handle_multimodal(request)


@app.post("/byoc-hashbrown")
async def run_byoc_hashbrown(request: Request):
    """BYOC: Hashbrown demo endpoint.

    Emits a hashbrown-shaped JSON envelope (`{"ui": [...]}`) that the
    frontend's `useJsonParser` + `useUiKit` parses progressively as the
    response streams.
    """
    return await handle_byoc_hashbrown(request)


@app.post("/byoc-json-render")
async def run_byoc_json_render(request: Request):
    """BYOC: json-render demo endpoint.

    Emits a flat element-map spec (`{"root", "elements"}`) that
    @json-render/react renders against a Zod-validated catalog.
    """
    return await handle_byoc_json_render(request)


@app.post("/a2ui-fixed-schema")
async def run_a2ui_fixed_schema(request: Request):
    """A2UI Fixed Schema demo endpoint.

    The agent ships ``flight_schema.json`` as a fixed component tree and
    only streams *data* into the data model at runtime. The
    ``display_flight`` tool returns an ``a2ui_operations`` container
    (``create_surface`` + ``update_components`` + ``update_data_model``)
    that the Next.js A2UI middleware detects and forwards to the
    frontend renderer. The dedicated runtime route at
    ``api/copilotkit-a2ui-fixed-schema/route.ts`` is configured with
    ``injectA2UITool: false`` because the agent owns the tool itself.
    """
    return await handle_a2ui_fixed_schema(request)


@app.post("/mcp-apps")
async def run_mcp_apps(request: Request):
    """MCP Apps demo endpoint.

    Forwards the runtime-supplied MCP tool catalog to OpenAI; the runtime
    middleware on the TypeScript side intercepts the resulting tool
    calls, fetches the MCP UI resource, and renders the sandboxed
    iframe.
    """
    return await handle_mcp_apps(request)


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
