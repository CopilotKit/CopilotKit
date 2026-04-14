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
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"))
from tools import get_weather_impl, query_data_impl, manage_sales_todos_impl, get_sales_todos_impl, schedule_meeting_impl


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


agent_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[change_background, generate_haiku, generate_task_steps],
    backend_tools=[get_weather, query_data, manage_sales_todos, get_sales_todos_tool, schedule_meeting],
    system_prompt=(
        "You are a helpful sales assistant that can: "
        "get the weather for a given location, "
        "query financial data for charts and graphs, "
        "manage a sales pipeline with todos, "
        "schedule meetings (requires human approval), "
        "change the background color/gradient of the chat area, "
        "generate haikus with Japanese and English text, "
        "and generate task step plans for user review. "
        "When asked about weather, always use the get_weather tool and return the JSON result. "
        "When asked to plan or create steps, use the generate_task_steps tool. "
        "When asked about financial data or charts, use query_data first."
    ),
    initial_state={
        "todos": [],
    },
)
