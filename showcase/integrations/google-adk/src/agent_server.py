"""Agent Server for Google ADK.

FastAPI server that hosts ALL ADK agents for this showcase package. Each demo
gets its own ADKAgent middleware mounted at /<agent_name>; the Next.js
CopilotKit runtime in src/app/api/copilotkit/route.ts proxies each agent name
to the matching backend path via AG-UI protocol.

NOTE on /agents/state: ag_ui_adk.endpoint.add_adk_fastapi_endpoint() also
registers a hardcoded `POST /agents/state` route. Calling it N times
registers N duplicate handlers; FastAPI/Starlette serve whichever was
registered first — which for us is the FIRST entry in `AGENT_REGISTRY`
iteration order (currently `agentic_chat`, backed by the shared
`_simple_chat` LlmAgent). All demos that share `_simple_chat`
(prebuilt-sidebar, prebuilt-popup, chat-slots, chat-customization-css,
headless-simple, headless-complete, voice, frontend-tools, etc.) get
correct behaviour from the same session service. Demos with their own
LlmAgent (gen-ui-agent, subagents, shared-state-streaming, agent-config,
…) currently store sessions in their own ADKAgent's service that
/agents/state does NOT reach — those sessions are still readable via the
in-stream STATE_DELTA path used by useAgent, just not via the optional
/agents/state retrieval endpoint. A proper fix is in ag_ui_adk
(de-hardcode the path), tracked separately.
"""

import os

# CVDIAG bootstrap — MUST be the first non-stdlib import (folded in from the
# dropped L1-H slot). Importing this module configures the root logger via
# ``logging.basicConfig`` so the ``agents._header_forwarding`` CVDIAG loggers
# actually EMIT, and resolves the verbosity tier + PB writer. It imports
# pydantic/starlette only (NOT ADK / google-genai), so it is safe to run before
# the httpx hook install below — it does not construct Gemini's httpx client.
import _shared.cvdiag_bootstrap  # noqa: F401,E402  (first non-stdlib import — bootstrap side effects)

# ORDER-CRITICAL: install the global httpx hook BEFORE any ``agents.*``
# import. ADK / google-genai construct Gemini's httpx client during agent
# module import, so the patch must be in place before those imports run.
from agents._cvdiag_backend import CvdiagBackendMiddleware  # noqa: E402
from agents._header_forwarding import (  # noqa: E402
    HeaderForwardingHTTPMiddleware,
    install_global_httpx_hook,
)

install_global_httpx_hook()

import uvicorn
from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from dotenv import load_dotenv

from agents.registry import AGENT_REGISTRY

load_dotenv()

app = FastAPI(title="Google ADK Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# `add_adk_fastapi_endpoint(app, adk_agent, path="/<name>")` installs POST
# routes; middleware runs above the routing layer, so /health stays reachable.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)

# Forward inbound x-* headers onto outbound httpx calls so aimock fixture
# matching sees the in-flight test's ``x-aimock-context``. Paired with
# ``install_global_httpx_hook`` above for clients constructed lazily.
app.add_middleware(HeaderForwardingHTTPMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# CVDIAG backend emitter (spec §3 Layer 2) — emits the HTTP-observable backend
# boundaries (request.ingress, sse.first_byte, sse.event, sse.aborted,
# response.complete, error.caught) as structured CVDIAG envelopes. Added LAST so
# it is the OUTERMOST layer: it observes ingress before any inner layer mutates
# the request and wraps the response stream so SSE boundaries fire as chunks
# flow. Gated behind ``CVDIAG_BACKEND_EMITTER`` (default OFF, canary-safe) — the
# middleware fast-paths to a bare pass-through when the flag is unset.
app.add_middleware(CvdiagBackendMiddleware)


# Mount one ADKAgent per registered agent at /<agent_name>.
for agent_name, spec in AGENT_REGISTRY.items():
    middleware = ADKAgent(
        adk_agent=spec.llm_agent,
        user_id="demo_user",
        session_timeout_seconds=3600,
        use_in_memory_services=True,
        predict_state=spec.predict_state,
        emit_messages_snapshot=spec.emit_messages_snapshot,
        streaming_function_call_arguments=spec.streaming_function_call_arguments,
    )
    add_adk_fastapi_endpoint(app, middleware, path=f"/{agent_name}")


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    # Reload is dev-only — it spawns a file-watching subprocess that pegs
    # CPU and rebuilds in-memory ADK sessions on every fs touch. Gate
    # explicitly via UVICORN_RELOAD=1 (entrypoint.sh sets PORT but no
    # reload flag, so production stays cool).
    reload = os.getenv("UVICORN_RELOAD", "0") == "1"
    uvicorn.run(
        "agent_server:app",
        host="0.0.0.0",
        port=port,
        reload=reload,
    )


if __name__ == "__main__":
    main()
