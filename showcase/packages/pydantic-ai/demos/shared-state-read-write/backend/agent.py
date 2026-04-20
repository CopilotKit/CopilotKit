"""PydanticAI agent for the Shared State (Writing) cell.

The frontend writes to agent state; the agent reads that state and can
also mutate it. Minimal implementation — state schema is a list of
todos/deals.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Any

from ag_ui.core import EventType, StateSnapshotEvent
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel

load_dotenv()


class State(BaseModel):
    todos: list[dict[str, Any]] = Field(default_factory=list)


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1-mini"),
    deps_type=StateDeps[State],
    system_prompt=dedent("""
        You are a helpful assistant. The frontend maintains a list of
        todos/deals in shared state. Use set_todos to replace the list
        when the user asks you to add, remove, or change items.
    """).strip(),
)


@agent.tool
async def set_todos(
    ctx: RunContext[StateDeps[State]],
    todos: list[dict[str, Any]],
) -> StateSnapshotEvent:
    """Replace the full list of todos."""
    ctx.deps.state.todos = todos
    return StateSnapshotEvent(
        type=EventType.STATE_SNAPSHOT,
        snapshot=ctx.deps.state,
    )
