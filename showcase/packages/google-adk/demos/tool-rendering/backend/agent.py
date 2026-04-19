"""Google ADK agent backing the Tool Rendering demo.

The agent exposes a `get_weather` tool; the frontend renders the result as a
weather card via `useRenderTool`.
"""

from __future__ import annotations

from dotenv import load_dotenv
from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

from tools import get_weather_impl

load_dotenv()


def get_weather(tool_context: ToolContext, location: str) -> dict:
    """Get the weather for a given location."""
    return get_weather_impl(location)


tool_rendering_agent = LlmAgent(
    name="ToolRenderingAgent",
    model="gemini-2.5-flash",
    instruction=(
        "You are a helpful assistant. When the user asks about the weather, "
        "call the get_weather tool with the specified location."
    ),
    tools=[get_weather],
)
