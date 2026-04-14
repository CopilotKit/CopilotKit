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

import sys
import os

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"),
)
from tools import get_weather_impl, query_data_impl, manage_sales_todos_impl, get_sales_todos_impl, schedule_meeting_impl

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
