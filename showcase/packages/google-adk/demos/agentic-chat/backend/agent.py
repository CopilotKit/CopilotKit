"""Google ADK agent backing the Agentic Chat demo.

The demo UI exposes a `change_background` frontend tool and a `get_weather`
render tool. `change_background` lives on the client, so only `get_weather`
needs a backend implementation.
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


agentic_chat_agent = LlmAgent(
    name="AgenticChatAgent",
    model="gemini-2.5-flash",
    instruction=(
        "You are a helpful, conversational assistant. "
        "When the user asks about the weather, call the get_weather tool. "
        "When the user asks to change the background color or gradient, call "
        "the change_background frontend tool (exposed by the client)."
    ),
    tools=[get_weather],
)
