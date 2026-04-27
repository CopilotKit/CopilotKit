"""Agent Server for Google ADK.

FastAPI server that hosts ALL ADK agents for this showcase package. Each demo
gets its own ADKAgent middleware mounted at /<agent_name>; the Next.js
CopilotKit runtime in src/app/api/copilotkit/route.ts proxies each agent name
to the matching backend path via AG-UI protocol.

NOTE on /agents/state: ag_ui_adk.endpoint.add_adk_fastapi_endpoint() also
registers a hardcoded `POST /agents/state` route. Calling it N times registers
N duplicate handlers; FastAPI/Starlette serve whichever was registered first.
For our demos this is fine — only a handful (e.g. headless-complete) call
that endpoint, and they all use the first registered agent's session service.
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
    )
    add_adk_fastapi_endpoint(app, middleware, path=f"/{agent_name}")


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
