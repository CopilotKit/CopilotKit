"""MS Agent Framework (Python) agent backing the Tool Rendering cell.

Exposes a single `get_weather` tool; the frontend uses `useRenderTool` to
render a rich WeatherCard when the agent calls it.
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

sys.path.insert(0, "/app/shared/python")
from tools import get_weather_impl  # type: ignore  # noqa: E402

load_dotenv()


@tool(
    name="get_weather",
    description="Get the current weather for a location. The frontend will render the result as a card.",
)
def get_weather(
    location: Annotated[str, Field(description="City or region, fully spelled out.")],
) -> str:
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
        name="tool_rendering",
        instructions=dedent(
            """
            When the user asks about the weather in any city, call `get_weather`
            so the frontend can render a styled weather card. After the tool returns,
            provide a brief confirmation and do not call more tools unless asked.
            """
        ).strip(),
        tools=[get_weather],
    )
    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Agent that exposes a weather tool for frontend rendering.",
        require_confirmation=False,
    )


app = FastAPI(title="CopilotKit × MS Agent Framework — tool-rendering cell")
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
