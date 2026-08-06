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

from ag_ui_crewai import add_crewai_flow_fastapi_endpoint  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402

from agents.conversational_flows import CONVERSATIONAL_FLOW_TYPES  # noqa: E402


app = FastAPI(title="CrewAI Conversational Flows Agent Server")


class HealthMiddleware(BaseHTTPMiddleware):
    """Keep the backend health contract independent of agent endpoints."""

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

for feature, flow_type in CONVERSATIONAL_FLOW_TYPES.items():
    interrupt_feature = feature == "interrupt"
    add_crewai_flow_fastapi_endpoint(
        app,
        flow_type(),
        f"/conversational_flows/{feature}",
        conversational=True,
        emit_interrupt_outcome=interrupt_feature,
        enable_legacy_on_interrupt_event=not interrupt_feature,
    )
