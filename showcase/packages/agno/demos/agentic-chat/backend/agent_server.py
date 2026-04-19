"""Agno agent backing the Agentic Chat demo.

Exposes a single Agno Agent through AgentOS + AGUI on :8000/agui.
The Next.js frontend's /api/copilotkit route proxies CopilotKit calls here.

Tools:
  - get_weather (backend impl, rendered by the frontend via useRenderTool)
  - change_background (external_execution — runs on the frontend)
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
        "windSpeed": 8,
        "wind_speed": 8,
        "feels_like": 22,
    })


@tool(external_execution=True)
def change_background(background: str):
    """Change the background of the chat UI.

    Only call this tool when the user explicitly asks to change the
    background. The actual change is performed on the frontend.
    """


agent = Agent(
    name="agentic_chat",
    model=OpenAIChat(id="gpt-4o-mini"),
    tools=[get_weather, change_background],
    description="You are a helpful assistant for the Agentic Chat showcase demo.",
    instructions=(
        "Use get_weather when the user asks about the weather.\n"
        "Use change_background only when the user explicitly asks to change "
        "colors/background. Prefer CSS gradients."
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
