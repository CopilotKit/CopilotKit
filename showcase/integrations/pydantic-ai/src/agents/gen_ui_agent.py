"""Agentic planner that publishes its step state to the shared demo UI."""

from typing import Literal

from ag_ui.core import EventType, StateSnapshotEvent
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.ui import StateDeps


class Step(BaseModel):
    id: str
    title: str
    status: Literal["pending", "in_progress", "completed"]


class GenUiAgentState(BaseModel):
    steps: list[Step] = Field(default_factory=list)


agent = Agent(
    model=OpenAIResponsesModel("gpt-5-mini"),
    deps_type=StateDeps[GenUiAgentState],
    system_prompt=(
        "You are an agentic planner. For each user request, plan exactly "
        "three concrete steps and call set_steps with all three pending. "
        "Work through the steps in order: publish the current step as "
        "in_progress, then publish it as completed, calling set_steps after "
        "each transition with the full list. Never call set_steps in parallel. "
        "After all three steps are completed, send one final conversational "
        "summary and stop."
    ),
)


@agent.tool
async def set_steps(
    ctx: RunContext[StateDeps[GenUiAgentState]],
    steps: list[Step],
) -> StateSnapshotEvent:
    """Publish the full plan whenever a step's status changes."""
    ctx.deps.state.steps = steps
    return StateSnapshotEvent(
        type=EventType.STATE_SNAPSHOT,
        snapshot=ctx.deps.state.model_dump(),
    )
