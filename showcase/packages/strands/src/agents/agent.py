"""
Strands agent with sales pipeline state, weather tool, and HITL support.

Adapted from examples/integrations/strands-python/agent/main.py
"""

import json
import os
import sys

from ag_ui_strands import (
    StrandsAgent,
    StrandsAgentConfig,
    ToolBehavior,
    create_strands_app,
)
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from strands import Agent, tool
from strands.models.openai import OpenAIModel

load_dotenv()

# Import shared tool implementations
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"))
from tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)


# =====
# Tools
# =====
@tool
def get_weather(location: str):
    """Get current weather for a location.

    Args:
        location: The location to get weather for

    Returns:
        Weather information as JSON string
    """
    return json.dumps(get_weather_impl(location))


@tool
def query_data(query: str):
    """Query financial database for chart data.

    Always call before showing a chart or graph.

    Args:
        query: Natural language query for financial data

    Returns:
        Financial data as JSON string
    """
    return json.dumps(query_data_impl(query))


@tool
def manage_sales_todos(todos: list[dict]):
    """Manage the sales pipeline by replacing the entire list of todos.

    IMPORTANT: Always provide the entire list, not just new items.

    Args:
        todos: The complete updated list of sales todos

    Returns:
        Success message
    """
    result = manage_sales_todos_impl(todos)
    return f"Sales todos updated. Tracking {len(result)} item(s)."


@tool
def get_sales_todos():
    """Get the current sales pipeline todos.

    Returns:
        Instruction to check the sales pipeline in context
    """
    return "Check the sales pipeline provided in the context."


@tool
def schedule_meeting(reason: str):
    """Schedule a meeting with user approval.

    Args:
        reason: Reason for the meeting

    Returns:
        Meeting scheduling result as JSON string
    """
    return json.dumps(schedule_meeting_impl(reason))


@tool
def search_flights(flights: list[dict]):
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: airline, airlineLogo, flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" -- use near-future dates),
    departureTime, arrivalTime, duration (e.g. "4h 25m"),
    status (e.g. "On Time" or "Delayed"),
    statusColor (hex color for status dot),
    price (e.g. "$289"), and currency (e.g. "USD").

    For airlineLogo use Google favicon API:
    https://www.google.com/s2/favicons?domain={airline_domain}&sz=128

    Args:
        flights: List of flight objects

    Returns:
        Flight search results as JSON string
    """
    result = search_flights_impl(flights)
    return json.dumps(result)


@tool
def generate_a2ui(context: str):
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.

    Args:
        context: Conversation context to generate UI from

    Returns:
        A2UI operations as JSON string
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


@tool
def set_theme_color(theme_color: str):
    """Change the theme color of the UI.

    This is a frontend tool - it returns None as the actual
    execution happens on the frontend via useFrontendTool.

    Args:
        theme_color: The color to set as theme
    """
    return None


# =====
# State management
# =====
def build_sales_prompt(input_data, user_message: str) -> str:
    """Inject the current sales pipeline state into the prompt."""
    state_dict = getattr(input_data, "state", None)
    if isinstance(state_dict, dict) and "todos" in state_dict:
        todos_json = json.dumps(state_dict["todos"], indent=2)
        return (
            f"Current sales pipeline:\n{todos_json}\n\nUser request: {user_message}"
        )
    return user_message


async def sales_state_from_args(context):
    """Extract sales pipeline state from tool arguments.

    This function is called when manage_sales_todos tool is executed
    to emit a state snapshot to the UI.

    Args:
        context: ToolResultContext containing tool execution details

    Returns:
        dict: State snapshot with todos array, or None on error
    """
    try:
        tool_input = context.tool_input
        if isinstance(tool_input, str):
            tool_input = json.loads(tool_input)

        todos_data = tool_input.get("todos", tool_input)

        # Process through shared implementation
        if isinstance(todos_data, list):
            processed = manage_sales_todos_impl(todos_data)
            return {"todos": [dict(t) for t in processed]}

        return None
    except Exception:
        return None


# =====
# Agent configuration
# =====
shared_state_config = StrandsAgentConfig(
    state_context_builder=build_sales_prompt,
    tool_behaviors={
        "manage_sales_todos": ToolBehavior(
            skip_messages_snapshot=True,
            state_from_args=sales_state_from_args,
        )
    },
)

# Initialize OpenAI model
api_key = os.getenv("OPENAI_API_KEY", "")
model = OpenAIModel(
    client_args={"api_key": api_key},
    model_id="gpt-4o",
)

system_prompt = (
    "You are a polished, professional demo assistant for CopilotKit. "
    "Keep responses brief and clear -- 1 to 2 sentences max.\n\n"
    "You can:\n"
    "- Chat naturally with the user\n"
    "- Change the UI background when asked (via frontend tool)\n"
    "- Query data and render charts (via query_data tool)\n"
    "- Get weather information (via get_weather tool)\n"
    "- Schedule meetings with the user (via schedule_meeting tool -- the user picks a time in the UI)\n"
    "- Manage sales pipeline todos (via manage_sales_todos / get_sales_todos tools)\n"
    "- Search flights and display rich A2UI cards (via search_flights tool)\n"
    "- Generate dynamic A2UI dashboards from conversation context (via generate_a2ui tool)\n"
    "- Generate step-by-step plans for user review (human-in-the-loop)\n"
    "When discussing the sales pipeline, ALWAYS use the get_sales_todos tool to see the current list before "
    "mentioning, updating, or discussing todos with the user."
)

# Create Strands agent with tools
strands_agent = Agent(
    model=model,
    system_prompt=system_prompt,
    tools=[get_sales_todos, manage_sales_todos, get_weather, query_data, schedule_meeting, search_flights, generate_a2ui, set_theme_color],
)

# Wrap with AG-UI integration
agui_agent = StrandsAgent(
    agent=strands_agent,
    name="strands_agent",
    description="A sales assistant that collaborates with you to manage a sales pipeline",
    config=shared_state_config,
)
