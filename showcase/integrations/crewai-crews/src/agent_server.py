"""FastAPI composition root for the CrewAI showcase backend."""

# CVDIAG bootstrap must be the first non-stdlib import. It configures logging
# before the request-header forwarding and provider clients are imported.
import _shared.cvdiag_bootstrap  # noqa: F401,E402

from dotenv import load_dotenv

from aimock_toggle import configure_aimock

load_dotenv()
configure_aimock()

# Install the global httpx hook before importing CrewAI/LiteLLM-backed agents.
from agents._cvdiag_backend import CvdiagBackendMiddleware
from agents._header_forwarding import (
    HeaderForwardingHTTPMiddleware,
    install_global_httpx_hook,
)

install_global_httpx_hook()

from ag_ui_crewai import (  # noqa: E402
    add_crewai_crew_fastapi_endpoint,
    add_crewai_flow_fastapi_endpoint,
)
from _shared.ag_ui_crewai_compat import install_resume_status_compat  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402

from agents.a2ui_fixed import a2ui_fixed_flow  # noqa: E402
from agents.a2ui_recovery_flow import a2ui_recovery_flow  # noqa: E402
from agents.beautiful_chat_flow import beautiful_chat_flow  # noqa: E402
from agents.byoc_hashbrown_agent import ByocHashbrown  # noqa: E402
from agents.byoc_json_render_agent import ByocJsonRender  # noqa: E402
from agents.crew import LatestAiDevelopment  # noqa: E402
from agents.declarative_gen_ui import declarative_gen_ui_flow  # noqa: E402
from agents.frontend_tool_flow import frontend_tool_flow  # noqa: E402
from agents.gen_ui_agent import gen_ui_agent_flow  # noqa: E402
from agents.interrupt_flow import interrupt_flow  # noqa: E402
from agents.mcp_apps_agent import MCPApps  # noqa: E402
from agents.multimodal_flow import multimodal_flow  # noqa: E402
from agents.reasoning_flow import reasoning_flow  # noqa: E402
from agents.shared_state_read import shared_state_read_flow  # noqa: E402
from agents.shared_state_read_write import shared_state_read_write_flow  # noqa: E402
from agents.shared_state_streaming import shared_state_streaming_flow  # noqa: E402
from agents.subagents import subagents_flow  # noqa: E402
from agents.tool_rendering_reasoning import (  # noqa: E402
    tool_rendering_reasoning_flow,
)

install_resume_status_compat()

try:
    from agents.tool_rendering import tool_rendering_flow
except ImportError:
    tool_rendering_flow = None


app = FastAPI(title="CrewAI (Crews) Agent Server")


class HealthMiddleware(BaseHTTPMiddleware):
    """Keep health reachable despite the shared root catch-all endpoint."""

    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)
app.add_middleware(HeaderForwardingHTTPMiddleware)
app.add_middleware(CvdiagBackendMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dedicated endpoints must be registered before the shared root catch-all.
add_crewai_flow_fastapi_endpoint(app, declarative_gen_ui_flow, "/declarative-gen-ui")
add_crewai_flow_fastapi_endpoint(app, a2ui_fixed_flow, "/a2ui-fixed-schema")
add_crewai_crew_fastapi_endpoint(app, ByocHashbrown(), "/byoc-hashbrown")
add_crewai_crew_fastapi_endpoint(app, ByocJsonRender(), "/byoc-json-render")
add_crewai_flow_fastapi_endpoint(app, beautiful_chat_flow, "/beautiful-chat")
add_crewai_crew_fastapi_endpoint(app, MCPApps(), "/mcp-apps")

add_crewai_flow_fastapi_endpoint(
    app, shared_state_read_write_flow, "/shared-state-read-write"
)
add_crewai_flow_fastapi_endpoint(app, shared_state_read_flow, "/shared-state-read")
add_crewai_flow_fastapi_endpoint(
    app, shared_state_streaming_flow, "/shared-state-streaming"
)
add_crewai_flow_fastapi_endpoint(app, multimodal_flow, "/multimodal")
add_crewai_flow_fastapi_endpoint(app, frontend_tool_flow, "/frontend-tools")
add_crewai_flow_fastapi_endpoint(app, a2ui_recovery_flow, "/a2ui-recovery")
add_crewai_flow_fastapi_endpoint(app, subagents_flow, "/subagents")
add_crewai_flow_fastapi_endpoint(app, gen_ui_agent_flow, "/gen-ui-agent")
add_crewai_flow_fastapi_endpoint(app, reasoning_flow, "/reasoning")
add_crewai_flow_fastapi_endpoint(
    app,
    interrupt_flow,
    "/interrupt",
    emit_interrupt_outcome=True,
    enable_legacy_on_interrupt_event=False,
)
if tool_rendering_flow is not None:
    add_crewai_flow_fastapi_endpoint(app, tool_rendering_flow, "/tool-rendering")
add_crewai_flow_fastapi_endpoint(
    app, tool_rendering_reasoning_flow, "/tool-rendering-reasoning"
)

add_crewai_crew_fastapi_endpoint(app, LatestAiDevelopment(), "/")
