"""Agno agent backing the Tool Rendering demo.

get_weather is a backend tool; the frontend renders its call/result via
useRenderTool.
"""

from __future__ import annotations

import json
import os

import dotenv
from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.os import AgentOS
from agno.os.interfaces.agui import AGUI
from agno.tools import tool

dotenv.load_dotenv()


@tool
def get_weather(location: str):
    """Return simple canned weather data for a location.

    Args:
        location: The location to get the weather for.
    """
    return json.dumps({
        "city": location,
        "temperature": 22,
        "conditions": "Sunny",
        "humidity": 55,
        "wind_speed": 8,
        "feels_like": 22,
    })


agent = Agent(
    name="tool_rendering",
    model=OpenAIChat(id="gpt-4o-mini"),
    tools=[get_weather],
    description="You are a helpful weather assistant.",
    instructions=(
        "Use get_weather whenever the user asks about weather. If no location "
        "is given, default to 'the whole wide world'."
    ),
)

agent_os = AgentOS(agents=[agent], interfaces=[AGUI(agent=agent)])
app = agent_os.get_app()


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    agent_os.serve(app="agent_server:app", host="0.0.0.0", port=port)
