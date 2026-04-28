"""
PydanticAI agent with sales todos state, weather/query tools, and HITL scheduling.

Upgraded from proverbs demo to full feature parity with shared tool implementations.
"""

import json
from textwrap import dedent
from typing import Any
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from ag_ui.core import EventType, StateSnapshotEvent
from pydantic_ai.models.openai import OpenAIResponsesModel

from dotenv import load_dotenv

from tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)
from tools.types import Flight

load_dotenv()


# =====
# State
# =====
class SalesTodosState(BaseModel):
    """Sales pipeline todos managed by the agent."""
    todos: list[dict[str, Any]] = Field(
        default_factory=list,
        description="The list of sales pipeline todos",
    )


# =====
# Agent
# =====
agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1-mini"),
    deps_type=StateDeps[SalesTodosState],
    system_prompt=dedent("""
        You are a helpful sales assistant that helps manage a sales pipeline.

        The user has a list of sales todos that you can help them manage.
        You have tools available to add, update, or retrieve todos from the pipeline.
        You can also look up weather and query financial data.
        You can search flights and display rich A2UI cards (via search_flights tool).
        You can generate dynamic A2UI dashboards from conversation context (via generate_a2ui tool).

        When discussing sales todos, ALWAYS use the get_sales_todos tool to see the current list
        before mentioning, updating, or discussing todos with the user.
    """).strip(),
)


# =====
# Tools
# =====
@agent.tool
def get_weather(ctx: RunContext[StateDeps[SalesTodosState]], location: str) -> str:
    """Get the weather for a given location. Ensure location is fully spelled out."""
    return json.dumps(get_weather_impl(location))


@agent.tool
def query_data(ctx: RunContext[StateDeps[SalesTodosState]], query: str) -> str:
    """Query financial database for chart data. Returns data suitable for pie or bar charts."""
    return json.dumps(query_data_impl(query))


@agent.tool
async def manage_sales_todos(
    ctx: RunContext[StateDeps[SalesTodosState]], todos: list[dict[str, Any]]
) -> StateSnapshotEvent:
    """Manage the sales pipeline. Pass the complete list of sales todos."""
    result = manage_sales_todos_impl(todos)
    ctx.deps.state.todos = result
    return StateSnapshotEvent(
        type=EventType.STATE_SNAPSHOT,
        snapshot=ctx.deps.state,
    )


@agent.tool
def get_sales_todos(ctx: RunContext[StateDeps[SalesTodosState]]) -> str:
    """Get the current list of sales pipeline todos."""
    return json.dumps(get_sales_todos_impl(ctx.deps.state.todos or None))


@agent.tool
def schedule_meeting(ctx: RunContext[StateDeps[SalesTodosState]], reason: str, duration_minutes: int = 30) -> str:
    """Schedule a meeting. The user will be asked to pick a time via the UI."""
    return json.dumps(schedule_meeting_impl(reason, duration_minutes))


@agent.tool
def search_flights(ctx: RunContext[StateDeps[SalesTodosState]], flights: list[dict[str, Any]]) -> str:
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


@agent.tool
def generate_a2ui(ctx: RunContext[StateDeps[SalesTodosState]]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.
    """
    from openai import OpenAI

    # Extract conversation messages from deps
    copilotkit_state = getattr(ctx.deps, "copilotkit", None)
    conversation_messages: list[dict] = []
    context_entries: list[dict] = []
    if copilotkit_state:
        if hasattr(copilotkit_state, "messages"):
            for msg in (copilotkit_state.messages or []):
                role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
                if role in ("user", "assistant"):
                    content = ""
                    if hasattr(msg, "content"):
                        if isinstance(msg.content, str):
                            content = msg.content
                        elif isinstance(msg.content, list):
                            parts = []
                            for part in msg.content:
                                if hasattr(part, "text"):
                                    parts.append(part.text)
                                elif isinstance(part, dict) and "text" in part:
                                    parts.append(part["text"])
                            content = "".join(parts)
                    if content:
                        conversation_messages.append({"role": role, "content": content})
        if hasattr(copilotkit_state, "context"):
            context_entries = copilotkit_state.context or []

    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )

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

    llm_messages: list[dict] = [
        {"role": "system", "content": context_text or "Generate a useful dashboard UI."},
    ]
    llm_messages.extend(conversation_messages)

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=llm_messages,
        tools=[tool_schema],
        tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
    )

    if not response.choices[0].message.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.choices[0].message.tool_calls[0]
    args = json.loads(tool_call.function.arguments)
    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)
