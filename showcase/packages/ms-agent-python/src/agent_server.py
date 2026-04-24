"""
Agent Server for MS Agent Framework (Python)

FastAPI server that hosts the Microsoft Agent Framework agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

from __future__ import annotations

import os

import uvicorn
from agent_framework import BaseChatClient
from agent_framework.openai import OpenAIChatClient
from agent_framework_ag_ui import add_agent_framework_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from agents.agent import create_agent
from agents.a2ui_dynamic import create_agent as create_a2ui_dynamic_agent
from agents.a2ui_fixed import create_agent as create_a2ui_fixed_agent

load_dotenv()


def _build_chat_client() -> BaseChatClient:
    try:
        if bool(os.getenv("OPENAI_API_KEY")):
            return OpenAIChatClient(
                model=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
                api_key=os.getenv("OPENAI_API_KEY"),
            )

        raise ValueError("OPENAI_API_KEY environment variable is required")

    except Exception as exc:
        raise RuntimeError(
            "Unable to initialize the chat client. Double-check your API credentials."
        ) from exc


chat_client = _build_chat_client()
my_agent = create_agent(chat_client)

app = FastAPI(title="CopilotKit + Microsoft Agent Framework (Python)")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# `add_agent_framework_fastapi_endpoint(..., path="/")` installs a catch-all
# at the root that shadows any later `@app.get("/health")` decorator.
# Middleware runs above the routing layer, so /health stays reachable.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# A2UI demos — mount BEFORE the root catch-all. `add_agent_framework_fastapi_endpoint(..., path="/")`
# installs a wildcard that would otherwise swallow any later-registered sub-paths.
a2ui_dynamic_agent = create_a2ui_dynamic_agent(chat_client)
add_agent_framework_fastapi_endpoint(
    app=app,
    agent=a2ui_dynamic_agent,
    path="/a2ui_dynamic",
)

a2ui_fixed_agent = create_a2ui_fixed_agent(chat_client)
add_agent_framework_fastapi_endpoint(
    app=app,
    agent=a2ui_fixed_agent,
    path="/a2ui_fixed",
)

add_agent_framework_fastapi_endpoint(
    app=app,
    agent=my_agent,
    path="/",
)


def main():
    """Run the uvicorn server."""
    host = os.getenv("AGENT_HOST", "0.0.0.0")
    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run("agent_server:app", host=host, port=port, reload=True)


if __name__ == "__main__":
    main()
