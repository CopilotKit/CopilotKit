"""
Beautiful Chat -- flagship MS Agent Framework showcase.

A polished sales-dashboard agent that exercises A2UI (fixed + dynamic),
Open Generative UI, and controlled generative UI components simultaneously.
The Python agent hosts the tool surface; the frontend wires a dedicated
runtime endpoint that enables A2UI (without injecting the default A2UI
tool), Open Generative UI, and MCP Apps (pointed at Excalidraw by default).

Reference:
- showcase/integrations/langgraph-python/src/agents/beautiful_chat.py
- showcase/integrations/ms-agent-python/src/agents/agent.py (shared tool patterns)
"""

from __future__ import annotations

import csv
import json
import uuid
from pathlib import Path
from textwrap import dedent
from typing import Annotated, Any

from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field

# Shared tool implementations live in `showcase/shared/python/tools/`.
from tools import (
    build_a2ui_operations_from_tool_call,
    search_flights_impl,
)


# ---------------------------------------------------------------------
# Local data for the sales dashboard -- a self-contained copy of the
# sample CSV the LangGraph beautiful-chat cell uses. We inline it here
# (rather than reading from shared/python/data/db.csv) so the sales
# dashboard demo stays self-contained even if the shared data ever drifts.
# ---------------------------------------------------------------------

_DATA_DIR = Path(__file__).parent / "beautiful_chat_data"
_CSV_PATH = _DATA_DIR / "db.csv"

if _CSV_PATH.exists():
    with open(_CSV_PATH) as _f:
        _CACHED_DATA: list[dict[str, Any]] = list(csv.DictReader(_f))
else:
    _CACHED_DATA = []


# ---------------------------------------------------------------------
# State schema for the todos panel. The frontend reads `todos` off of
# `agent.state` and renders the kanban-style canvas.
# ---------------------------------------------------------------------

STATE_SCHEMA: dict[str, object] = {
    "todos": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "title": {"type": "string"},
                "description": {"type": "string"},
                "emoji": {"type": "string"},
                "status": {"type": "string"},
            },
        },
        "description": "Ordered list of the user's todos for the canvas panel.",
    }
}

PREDICT_STATE_CONFIG: dict[str, dict[str, str]] = {
    "todos": {
        "tool": "manage_todos",
        "tool_argument": "todos",
    }
}


# ---------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------


@tool(
    name="manage_todos",
    description=(
        "Replace the entire list of todos with the provided values. Always "
        "include every todo you want to keep. Each todo needs: id, title, "
        "description, emoji (🎯/🔥/✅/💡/🚀), and status (pending|completed)."
    ),
)
def manage_todos(
    todos: Annotated[
        list[dict],
        Field(
            description=(
                "Complete source of truth for the user's todos. Maintain "
                "ordering and include the full list on each call."
            )
        ),
    ],
) -> str:
    """Persist the provided set of todos."""
    normalized: list[dict[str, Any]] = []
    for todo in todos:
        normalized.append(
            {
                "id": todo.get("id") or str(uuid.uuid4()),
                "title": todo.get("title", ""),
                "description": todo.get("description", ""),
                "emoji": todo.get("emoji", "🎯"),
                "status": todo.get("status", "pending"),
            }
        )
    return f"Todos updated. Tracking {len(normalized)} item(s)."


@tool(
    name="query_data",
    description=(
        "Query the sales database. Takes natural language. Always call "
        "before showing a chart or graph."
    ),
)
def query_data(
    query: Annotated[
        str,
        Field(description="Natural language query to run against the database."),
    ],
) -> str:
    """Return the full dataset as JSON (the model filters/aggregates client-side)."""
    del query  # the whole CSV is small enough to return verbatim
    return json.dumps(_CACHED_DATA)


@tool(
    name="search_flights",
    description=(
        "Search for flights and display the results as rich A2UI cards. "
        "Return exactly 2 flights. Each flight must have: airline, "
        "airlineLogo, flightNumber, origin, destination, date, "
        "departureTime, arrivalTime, duration, status, statusColor, price, "
        "currency."
    ),
)
def search_flights(
    flights: Annotated[
        list[dict],
        Field(description="List of flight objects to search and display."),
    ],
) -> str:
    """Display search results as A2UI cards via the fixed flight schema."""
    result = search_flights_impl(flights)
    return json.dumps(result)


@tool(
    name="generate_a2ui",
    description=(
        "Generate a dynamic A2UI dashboard based on the conversation. A "
        "secondary LLM designs the UI schema and data. Use this for rich "
        "custom dashboards (sales metrics, charts, tables, cards)."
    ),
)
def generate_a2ui(
    context: Annotated[
        str,
        Field(description="Conversation context to generate UI from."),
    ],
) -> str:
    """Generate a dynamic A2UI dashboard from conversation context."""
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
            {
                "role": "user",
                "content": "Generate a dynamic A2UI dashboard based on the conversation.",
            },
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


# ---------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------


SYSTEM_PROMPT = dedent(
    """
    You are a polished, professional demo assistant for a sales team. Keep
    responses to 1-2 sentences.

    Tool guidance:
    - Flights: call `search_flights` to show flight cards with the pre-built
      A2UI schema.
    - Dashboards & rich UI: call `generate_a2ui` to create dashboard UIs with
      metrics, charts, tables, and cards. It handles rendering automatically.
    - Charts: call `query_data` first, then render with the frontend chart
      components (`pieChart` / `barChart`).
    - Todos: enable app mode first (via the `enableAppMode` frontend tool),
      then call `manage_todos` with the full list.
    - Meetings: call the `scheduleTime` frontend tool (human-in-the-loop)
      when the user asks to schedule a meeting -- do NOT ask for approval
      yourself, the tool's picker handles it.
    - Theme: call the `toggleTheme` frontend tool to flip light/dark.

    State sync:
    - The current list of todos is provided in the conversation context.
    - When you add, remove, or reorder todos, call `manage_todos` with the
      full list. Never send partial updates.

    After executing tools, send a brief final message summarizing exactly
    what changed.
    """
).strip()


def create_beautiful_chat_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the flagship Beautiful Chat demo agent."""
    base_agent = Agent(
        client=chat_client,
        name="beautiful_chat_agent",
        instructions=SYSTEM_PROMPT,
        tools=[manage_todos, query_data, search_flights, generate_a2ui],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkBeautifulChat",
        description=(
            "Flagship showcase agent. Combines A2UI (fixed + dynamic), "
            "Open Generative UI, shared state (todos), and HITL via frontend "
            "tools to render a polished sales dashboard."
        ),
        predict_state_config=PREDICT_STATE_CONFIG,
        require_confirmation=False,
    )
