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
from agents.agent_config_agent import create_agent_config_agent
from agents.a2ui_dynamic import create_agent as create_a2ui_dynamic_agent
from agents.a2ui_fixed import create_agent as create_a2ui_fixed_agent
from agents.beautiful_chat import create_beautiful_chat_agent
from agents.multimodal_agent import create_multimodal_agent
from agents.reasoning_agent import create_reasoning_agent
from agents.tool_rendering_reasoning_chain_agent import (
    create_tool_rendering_reasoning_chain_agent,
)

load_dotenv()


def _build_chat_client(model_override: str | None = None) -> BaseChatClient:
    try:
        if bool(os.getenv("OPENAI_API_KEY")):
            return OpenAIChatClient(
                model=model_override or os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
                api_key=os.getenv("OPENAI_API_KEY"),
            )

        raise ValueError("OPENAI_API_KEY environment variable is required")

    except Exception as exc:
        raise RuntimeError(
            "Unable to initialize the chat client. Double-check your API credentials."
        ) from exc


chat_client = _build_chat_client()
my_agent = create_agent(chat_client)
agent_config_agent = create_agent_config_agent(chat_client)
reasoning_agent = create_reasoning_agent(chat_client)
tool_rendering_reasoning_chain_agent = create_tool_rendering_reasoning_chain_agent(
    chat_client
)
a2ui_dynamic_agent = create_a2ui_dynamic_agent(chat_client)
a2ui_fixed_agent = create_a2ui_fixed_agent(chat_client)

# Multimodal: vision-capable; gpt-4o-mini natively handles `image` parts.
# Scoped to its own endpoint so other demos don't silently upgrade to vision.
multimodal_chat_client = _build_chat_client("gpt-4o-mini")
multimodal_agent = create_multimodal_agent(multimodal_chat_client)

# Beautiful Chat: flagship polished sales dashboard demo. Combines A2UI
# (fixed + dynamic), Open Generative UI, shared-state todos, and HITL.
beautiful_chat_agent = create_beautiful_chat_agent(chat_client)

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

# IMPORTANT: mount specific-path agents BEFORE the catch-all `/` agent.
# `add_agent_framework_fastapi_endpoint(..., path="/")` installs a catch-all
# at the root that shadows any route registered AFTER it. FastAPI resolves
# routes in registration order, so specific paths must come first.

add_agent_framework_fastapi_endpoint(app=app, agent=multimodal_agent, path="/multimodal")
add_agent_framework_fastapi_endpoint(app=app, agent=beautiful_chat_agent, path="/beautiful-chat")
add_agent_framework_fastapi_endpoint(app=app, agent=agent_config_agent, path="/agent-config")
add_agent_framework_fastapi_endpoint(app=app, agent=reasoning_agent, path="/reasoning")
add_agent_framework_fastapi_endpoint(
    app=app, agent=tool_rendering_reasoning_chain_agent, path="/tool-rendering-reasoning-chain"
)
add_agent_framework_fastapi_endpoint(app=app, agent=a2ui_dynamic_agent, path="/a2ui_dynamic")
add_agent_framework_fastapi_endpoint(app=app, agent=a2ui_fixed_agent, path="/a2ui_fixed")

# Shared agent for the rest of the demos (must be last: `/` is a catch-all).
add_agent_framework_fastapi_endpoint(app=app, agent=my_agent, path="/")


def main():
    """Run the uvicorn server."""
    host = os.getenv("AGENT_HOST", "0.0.0.0")
    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run("agent_server:app", host=host, port=port, reload=True)


if __name__ == "__main__":
    main()
