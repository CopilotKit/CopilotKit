"""PydanticAI agent for the Agentic Generative UI cell.

The agent breaks a task into steps and streams progress via shared
state. The frontend renders a TaskProgress component.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Any, Literal

from ag_ui.core import EventType, StateSnapshotEvent
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel

load_dotenv()


class Step(BaseModel):
    description: str
    status: Literal["pending", "completed"] = "pending"


class State(BaseModel):
    steps: list[Step] = Field(default_factory=list)


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1-mini"),
    deps_type=StateDeps[State],
    system_prompt=dedent("""
        You are a planner. When the user asks you to build or plan
        something, use the set_steps tool to populate a list of pending
        steps, then use mark_step_completed to advance them as work is
        done. Keep descriptions short (under 80 chars).
    """).strip(),
)


@agent.tool
async def set_steps(
    ctx: RunContext[StateDeps[State]],
    steps: list[dict[str, Any]],
) -> StateSnapshotEvent:
    """Replace the full list of steps. Each step needs a description."""
    ctx.deps.state.steps = [
        Step(description=s.get("description", ""), status="pending")
        for s in steps
    ]
    return StateSnapshotEvent(
        type=EventType.STATE_SNAPSHOT,
        snapshot=ctx.deps.state,
    )


@agent.tool
async def mark_step_completed(
    ctx: RunContext[StateDeps[State]],
    index: int,
) -> StateSnapshotEvent:
    """Mark the step at the given 0-based index as completed."""
    if 0 <= index < len(ctx.deps.state.steps):
        ctx.deps.state.steps[index].status = "completed"
    return StateSnapshotEvent(
        type=EventType.STATE_SNAPSHOT,
        snapshot=ctx.deps.state,
    )
