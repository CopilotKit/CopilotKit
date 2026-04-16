"""
LangGraph agent for the CopilotKit Showcase (FastAPI variant).

Uses langgraph.prebuilt.create_react_agent with langgraph>=1.1.0.
"""

from src.agents.tools import (
    get_weather_impl,
    query_data_impl,
    schedule_meeting_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)
from src.agents.tools.types import SalesTodo, Flight

import json
import time
from typing import Any

from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool as lc_tool
from langchain_core.messages import SystemMessage
from langchain.agents import AgentState as BaseAgentState
from langchain.tools import ToolRuntime, tool
from langchain.messages import ToolMessage
from langgraph.types import Command

class AgentState(BaseAgentState):
    todos: list[SalesTodo]

@lc_tool
def get_weather(location: str):
    """Get the current weather for a location."""
    return get_weather_impl(location)

@lc_tool
def query_data(query: str):
    """Query the database. Takes natural language. Always call before showing a chart."""
    return query_data_impl(query)

@lc_tool
def schedule_meeting(reason: str, duration_minutes: int = 30):
    """Schedule a meeting. The user will be asked to pick a time via the UI."""
    return schedule_meeting_impl(reason, duration_minutes)

@lc_tool
def search_flights(flights: list[Flight]) -> str:
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: airline, airlineLogo, flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" -- use near-future dates),
    departureTime, arrivalTime, duration (e.g. "4h 25m"),
    status (e.g. "On Time" or "Delayed"),
    statusColor (hex color for status dot),
    price (e.g. "$289"), and currency (e.g. "USD").

    For airlineLogo use Google favicon API:
    https://www.google.com/s2/favicons?domain={airline_domain}&sz=128
    """
    result = search_flights_impl(flights)
    return json.dumps(result)

@tool
def manage_sales_todos(todos: list[SalesTodo], runtime: ToolRuntime) -> Command:
    """
    Manage the current sales todos. Pass the full updated list.
    """
    updated = manage_sales_todos_impl(todos)
    return Command(
        update={
            "todos": updated,
            "messages": [
                ToolMessage(
                    content="Successfully updated sales todos",
                    tool_call_id=runtime.tool_call_id,
                )
            ],
        }
    )

@tool
def get_sales_todos(runtime: ToolRuntime):
    """
    Get the current sales todos.
    """
    current = runtime.state.get("todos", [])
    return get_sales_todos_impl(current if current else None)

@lc_tool
def render_a2ui(
    surfaceId: str,
    catalogId: str,
    components: list[dict],
    data: dict | None = None,
) -> str:
    """Render a dynamic A2UI v0.9 surface."""
    return "rendered"

@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data.
    """
    t0 = time.time()
    messages = runtime.state["messages"][:-1]
    context_entries = runtime.state.get("copilotkit", {}).get("context", [])
    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )

    model = ChatOpenAI(model="gpt-4.1")
    model_with_tool = model.bind_tools([render_a2ui], tool_choice="render_a2ui")
    response = model_with_tool.invoke(
        [SystemMessage(content=context_text), *messages],
    )

    if not response.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    args = response.tool_calls[0]["args"]
    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)

model = ChatOpenAI(model="gpt-4o-mini")

SYSTEM_PROMPT = """You are a polished, professional demo assistant for CopilotKit.
Keep responses brief and clear -- 1 to 2 sentences max.

You can:
- Chat naturally with the user
- Change the UI background when asked (via frontend tool)
- Query data and render charts (via query_data tool)
- Get weather information (via get_weather tool)
- Schedule meetings with the user (via schedule_meeting tool -- the user picks a time in the UI)
- Manage sales pipeline todos (via manage_sales_todos / get_sales_todos tools)
- Search flights and display rich A2UI cards (via search_flights tool)
- Generate dynamic A2UI dashboards from conversation context (via generate_a2ui tool)
- Generate step-by-step plans for user review (human-in-the-loop)
"""

graph = create_react_agent(
    model=model,
    tools=[
        get_weather,
        query_data,
        schedule_meeting,
        search_flights,
        generate_a2ui,
        manage_sales_todos,
        get_sales_todos,
    ],
    prompt=SYSTEM_PROMPT,
)
