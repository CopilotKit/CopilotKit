"""
MS Agent Framework agent with sales todos state, weather tool, query data,
and HITL schedule meeting tool.

Adapted from examples/integrations/ms-agent-framework-python/agent/src/agent.py
"""

from __future__ import annotations

import json
import os
import sys
from textwrap import dedent
from typing import Annotated

from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field

# =====================================================================
# Shared tool implementations
# =====================================================================

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"),
)
from tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    schedule_meeting_impl,
)

STATE_SCHEMA: dict[str, object] = {
    "salesTodos": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "title": {"type": "string"},
                "stage": {"type": "string"},
                "value": {"type": "number"},
                "dueDate": {"type": "string"},
                "assignee": {"type": "string"},
                "completed": {"type": "boolean"},
            },
        },
        "description": "Ordered list of the user's sales pipeline todos.",
    }
}

PREDICT_STATE_CONFIG: dict[str, dict[str, str]] = {
    "salesTodos": {
        "tool": "manage_sales_todos",
        "tool_argument": "todos",
    }
}


@tool(
    name="manage_sales_todos",
    description=(
        "Replace the entire list of sales todos with the provided values. "
        "Always include every todo you want to keep."
    ),
)
def manage_sales_todos(
    todos: Annotated[
        list[dict],
        Field(
            description=(
                "The complete source of truth for the user's sales todos. "
                "Maintain ordering and include the full list on each call."
            )
        ),
    ],
) -> str:
    """Persist the provided set of sales todos."""
    result = manage_sales_todos_impl(todos)
    return f"Sales todos updated. Tracking {len(result)} item(s)."


@tool(
    name="get_sales_todos",
    description="Get the current list of sales todos.",
)
def get_sales_todos() -> str:
    """Return the current sales todos or defaults."""
    result = get_sales_todos_impl()
    return json.dumps(result)


@tool(
    name="get_weather",
    description="Get the current weather for a location. Use this to render the frontend weather card.",
)
def get_weather(
    location: Annotated[str, Field(description="The city or region to describe. Use fully spelled out names.")],
) -> str:
    """Return weather data as JSON for UI rendering."""
    result = get_weather_impl(location)
    return json.dumps(result)


@tool(
    name="query_data",
    description="Query the database. Takes natural language. Always call before showing a chart or graph.",
)
def query_data(
    query: Annotated[str, Field(description="Natural language query to run against the database.")],
) -> str:
    """Query the database and return results as JSON."""
    result = query_data_impl(query)
    return json.dumps(result)


@tool(
    name="schedule_meeting",
    description="Schedule a meeting. The user will be asked to pick a time via the meeting time picker UI.",
    approval_mode="always_require",
)
def schedule_meeting(
    reason: Annotated[str, Field(description="Reason for scheduling the meeting.")],
    duration_minutes: Annotated[int, Field(description="Duration of the meeting in minutes.")] = 30,
) -> str:
    """Request human approval to schedule a meeting."""
    result = schedule_meeting_impl(reason, duration_minutes)
    return json.dumps(result)


def create_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the CopilotKit demo agent backed by Microsoft Agent Framework."""
    base_agent = Agent(
        client=chat_client,
        name="sales_agent",
        instructions=dedent(
            """
            You help users manage their sales pipeline, check weather, query data, and schedule meetings.

            State sync:
            - The current list of sales todos is provided in the conversation context.
            - When you add, remove, or reorder todos, call `manage_sales_todos` with the full list.
              Never send partial updates--always include every todo that should exist.
            - CRITICAL: When asked to "add" a todo, you must:
              1. First, identify ALL existing todos from the conversation history
              2. Create EXACTLY ONE new todo (never more than one unless explicitly requested)
              3. Call manage_sales_todos with: [all existing todos] + [the one new todo]
            - When asked to "remove" a todo, remove exactly ONE item unless user specifies otherwise.

            Tool usage rules:
            - When user asks to schedule a meeting, you MUST call the `schedule_meeting` tool immediately.
              Do NOT ask for approval yourself--the tool's approval workflow and the client UI will handle it.

            Frontend integrations:
            - `get_weather` renders a weather card in the UI. Only call this tool when the user explicitly
              asks for weather. Do NOT call it after unrelated tasks or approvals.
            - `query_data` fetches database records. Always call before showing charts or graphs.
            - `schedule_meeting` requires explicit user approval before you proceed. Only use it when a
              user asks to schedule or set up a meeting. Always call the tool instead of asking manually.

            Conversation tips:
            - Reference the latest todo list before suggesting changes.
            - Keep responses concise and friendly unless the user requests otherwise.
            - After you finish executing tools for the user's request, provide a brief, final assistant
              message summarizing exactly what changed. Do NOT call additional tools or switch topics
              after that summary unless the user asks. ALWAYS send this conversational summary so the message persists.
            """.strip()
        ),
        tools=[manage_sales_todos, get_sales_todos, get_weather, query_data, schedule_meeting],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Manages sales pipeline todos, weather, data queries, and meeting scheduling.",
        state_schema=STATE_SCHEMA,
        predict_state_config=PREDICT_STATE_CONFIG,
        require_confirmation=False,
    )
