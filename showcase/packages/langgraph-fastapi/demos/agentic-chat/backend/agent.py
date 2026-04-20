"""LangGraph agent backing the Agentic Chat demo (FastAPI variant).

Exposes a single backend tool (get_weather) plus the CopilotKit middleware so
the frontend's frontend-tools and agent context are picked up at runtime.
"""

from langchain.agents import create_agent
from langchain_core.tools import tool as lc_tool
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

from tools import get_weather_impl


@lc_tool
def get_weather(location: str):
    """Get the current weather for a location."""
    return get_weather_impl(location)


graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[get_weather],
    middleware=[CopilotKitMiddleware()],
    system_prompt=(
        "You are a polished, concise demo assistant. "
        "Use the get_weather tool when asked about weather. "
        "Use the change_background frontend tool when asked to change the background."
    ),
)
