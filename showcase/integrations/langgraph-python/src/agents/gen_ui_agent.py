"""gen-ui-agent - minimal deep agent with explicit state + state-editing tool.

The agent plans a task as a list of steps and walks each step pending ->
in_progress -> completed, calling `set_steps` to publish state after each
transition. The frontend hook `useCoAgentStateRender` reads `state.steps`
and renders a progress card.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from copilotkit import CopilotKitMiddleware
from deepagents import create_deep_agent
from langchain.agents.middleware.types import AgentMiddleware, AgentState, OmitFromInput
from langchain.chat_models import init_chat_model
from langchain_core.messages import ToolMessage
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.types import Command
from typing_extensions import NotRequired, TypedDict


class Step(TypedDict):
    id: str
    title: str
    status: Literal["pending", "in_progress", "completed"]


def _last_steps(_prev: list[Step] | None, new: list[Step] | None) -> list[Step]:
    """Reducer: last write wins (accepts parallel tool calls in one superstep)."""
    return new if new is not None else (_prev or [])


class GenUiAgentState(AgentState):
    """Extends the base agent state with a typed `steps` field."""

    steps: Annotated[NotRequired[list[Step]], _last_steps, OmitFromInput]


@tool
def set_steps(
    steps: list[Step], tool_call_id: Annotated[str, InjectedToolCallId]
) -> Command[Any]:
    """Publish the current plan + step statuses. Call this every time a step
    transitions (including the first enumeration of steps)."""
    return Command(
        update={
            "steps": steps,
            "messages": [ToolMessage(f"Published {len(steps)} step(s).", tool_call_id=tool_call_id)],
        }
    )


# `create_deep_agent` does not accept `state_schema=` directly; the only way to
# extend the graph's state is via a middleware that declares `state_schema`.
# This one-liner exists solely to register `GenUiAgentState.steps`.
class _GenUiStateMiddleware(AgentMiddleware):
    state_schema = GenUiAgentState


SYSTEM_PROMPT = (
    "You are an agentic planner. For each user request: (1) plan exactly 3 "
    "concrete steps and call `set_steps` ONCE to publish them all with "
    "status=pending; (2) for each step in order: call `set_steps` with that "
    "step flipped to in_progress (all others unchanged); briefly simulate the "
    "work; then call `set_steps` with that step flipped to completed. Finally "
    "respond conversationally. Never call set_steps in parallel - always wait "
    "for one call to return before the next. Do NOT use write_todos - use "
    "set_steps only."
)

graph = create_deep_agent(
    model=init_chat_model("openai:gpt-4o-mini", temperature=0, use_responses_api=False),
    tools=[set_steps],
    system_prompt=SYSTEM_PROMPT,
    middleware=[CopilotKitMiddleware(), _GenUiStateMiddleware()],
).with_config({"recursion_limit": 200})
