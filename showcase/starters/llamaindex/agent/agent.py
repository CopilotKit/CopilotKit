"""
LlamaIndex AG-UI Agent

Uses llama-index-protocols-ag-ui to expose a LlamaIndex workflow as an
AG-UI compatible FastAPI router. The router handles all four demo
scenarios (agentic-chat, tool-rendering, hitl, gen-ui-tool-based) through
a single endpoint since LlamaIndex's get_ag_ui_workflow_router builds
the full AG-UI protocol surface automatically.
"""

import json
import os
import sys
from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

# Import shared tool implementations
from .tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)

# --- Frontend tools (executed client-side, agent just returns a confirmation) ---

def change_background(
    background: Annotated[str, "CSS background value. Prefer gradients."],
) -> str:
    """Change the background color/gradient of the chat area."""
    return f"Background changed to {background}"

def generate_haiku(
    japanese: Annotated[list[str], "3 lines of haiku in Japanese"],
    english: Annotated[list[str], "3 lines of haiku translated to English"],
    image_name: Annotated[str, "One relevant image name from the valid set"],
    gradient: Annotated[str, "CSS Gradient color for the background"],
) -> str:
    """Generate a haiku with Japanese text, English translation, and a background image."""
    return "Haiku generated!"

def generate_task_steps(
    steps: Annotated[
        list[dict],
        "Array of step objects with 'description' (string) and 'status' ('enabled' or 'disabled')"
    ],
) -> str:
    """Generate a list of task steps for the user to review and approve."""
    return f"Generated {len(steps)} steps for review"

# --- Backend tools (executed server-side, using shared implementations) ---

async def get_weather(
    location: Annotated[str, "The location to get the weather for."],
) -> str:
    """Get the weather for a given location. Returns temperature, conditions, humidity, wind speed, and feels-like temperature."""
    return json.dumps(get_weather_impl(location))

async def query_data(
    query: Annotated[str, "Natural language query for financial data."],
) -> str:
    """Query financial database for chart data. Always call before showing a chart or graph."""
    return json.dumps(query_data_impl(query))

async def manage_sales_todos(
    todos: Annotated[list[dict], "Complete list of sales todos to replace the current list."],
) -> str:
    """Manage the sales pipeline by replacing the entire list of todos."""
    result = manage_sales_todos_impl(todos)
    return json.dumps({"status": "updated", "count": len(result), "todos": [dict(t) for t in result]})

async def get_sales_todos_tool() -> str:
    """Get the current sales pipeline todos."""
    return json.dumps(get_sales_todos_impl(None))

async def schedule_meeting(
    reason: Annotated[str, "Reason for the meeting."],
) -> str:
    """Schedule a meeting with the user. Requires human approval."""
    return json.dumps(schedule_meeting_impl(reason))

async def search_flights(
    flights: Annotated[list[dict], "List of flight objects to search and display as rich cards. Return exactly 2 flights."],
) -> str:
    """Search for flights and display the results as rich A2UI cards.

    Each flight must have: airline, airlineLogo, flightNumber, origin, destination,
    date, departureTime, arrivalTime, duration, status, statusColor, price, currency.
    """
    result = search_flights_impl(flights)
    return json.dumps(result)

async def generate_a2ui(
    context: Annotated[str, "Conversation context to generate UI from."],
) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.
    """
    from openai import OpenAI

    client = OpenAI()
    tool_schema = {
        "type": "function",
        "function": {
            "name": "render_a2ui",
            "description": "Render a dynamic A2UI v0.9 surface.",
            "parameters": {
                "type": "object",
                "properties": {
                    "surfaceId": {"type": "string"},
                    "catalogId": {"type": "string"},
                    "components": {"type": "array", "items": {"type": "object"}},
                    "data": {"type": "object"},
                },
                "required": ["surfaceId", "catalogId", "components"],
            },
        },
    }

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {"role": "system", "content": context or "Generate a useful dashboard UI."},
            {"role": "user", "content": "Generate a dynamic A2UI dashboard based on the conversation."},
        ],
        tools=[tool_schema],
        tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
    )

    if not response.choices[0].message.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.choices[0].message.tool_calls[0]
    args = json.loads(tool_call.function.arguments)
    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)

agent_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[change_background, generate_haiku, generate_task_steps],
    backend_tools=[get_weather, query_data, manage_sales_todos, get_sales_todos_tool, schedule_meeting, search_flights, generate_a2ui],
    system_prompt=(
        "You are a polished, professional demo assistant for CopilotKit. "
        "Keep responses brief and clear -- 1 to 2 sentences max.\n\n"
        "You can:\n"
        "- Chat naturally with the user\n"
        "- Change the UI background when asked (via frontend tool)\n"
        "- Query data and render charts (via query_data tool)\n"
        "- Get weather information (via get_weather tool)\n"
        "- Schedule meetings with the user (via schedule_meeting tool)\n"
        "- Manage sales pipeline todos (via manage_sales_todos / get_sales_todos tools)\n"
        "- Search flights and display rich A2UI cards (via search_flights tool)\n"
        "- Generate dynamic A2UI dashboards from conversation context (via generate_a2ui tool)\n"
        "- Generate step-by-step plans for user review (human-in-the-loop)\n"
        "When asked about weather, always use the get_weather tool. "
        "When asked about financial data or charts, use query_data first."
    ),
    initial_state={
        "todos": [],
    },
)
