"""MS Agent Framework (Python) agent backing the Agentic Chat cell.

Minimal agent for the Agentic Chat demo. Exposes one backend tool
(`get_weather`); the frontend additionally supplies `change_background`
at runtime via useFrontendTool.
"""

from __future__ import annotations

import json
import os
import sys
from textwrap import dedent
from typing import Annotated

import uvicorn
from agent_framework import Agent, BaseChatClient, tool
from agent_framework.openai import OpenAIChatClient
from agent_framework_ag_ui import AgentFrameworkAgent, add_agent_framework_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import Field

# Shared Python tool implementations (staged into the image at /app/shared/python).
sys.path.insert(0, "/app/shared/python")
from tools import get_weather_impl  # type: ignore  # noqa: E402

load_dotenv()


@tool(
    name="get_weather",
    description="Get the current weather for a location. Use this to render the frontend weather card.",
)
def get_weather(
    location: Annotated[
        str,
        Field(description="The city or region to describe. Use fully spelled out names."),
    ],
) -> str:
    """Return weather data as JSON for UI rendering."""
    return json.dumps(get_weather_impl(location))


def _build_chat_client() -> BaseChatClient:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY environment variable is required")
    return OpenAIChatClient(
        model=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
        api_key=os.getenv("OPENAI_API_KEY"),
    )


def _create_agent() -> AgentFrameworkAgent:
    base_agent = Agent(
        client=_build_chat_client(),
        name="agentic_chat",
        instructions=dedent(
            """
            You are a helpful, concise assistant. The user's name is Bob (provided via
            agent context). When the user asks about weather, call the `get_weather` tool
            so the frontend can render a weather card. When the user asks to change the
            background, the frontend exposes a `change_background` tool — call it with a
            CSS value (colors or gradients).
            """
        ).strip(),
        tools=[get_weather],
    )
    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Agentic chat with weather and background tools.",
        require_confirmation=False,
    )


app = FastAPI(title="CopilotKit × MS Agent Framework — agentic-chat cell")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

add_agent_framework_fastapi_endpoint(app=app, agent=_create_agent(), path="/")


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("agent:app", host="0.0.0.0", port=int(os.getenv("AGENT_PORT", "8000")))
