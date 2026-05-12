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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
