"""gen-ui-agent — minimal agent with explicit state + state-editing tool.

The agent plans a task as a list of steps and walks each step pending ->
in_progress -> completed, calling `set_steps` to publish state after each
transition. The frontend subscribes to `state.steps` and renders a single
live progress card.

This used to wrap `deepagents.create_deep_agent`, which adds a planner +
sub-agent + write_todos middleware on top of the core ReAct loop. For a
task this simple (one tool, sequential calls) that planner ate enough
supersteps to repeatedly trip LangGraph's recursion limit before the
agent finished. Switched to the plain `langchain.agents.create_agent`
ReAct loop — one superstep per LLM/tool call — and pass the custom
state schema directly via `state_schema=` instead of through a
middleware-only workaround.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain.agents.middleware.types import AgentState, OmitFromInput
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
            "messages": [
                ToolMessage(
                    f"Published {len(steps)} step(s).",
                    name="set_steps",
                    id=str(uuid.uuid4()),
                    tool_call_id=tool_call_id,
                )
            ],
        }
    )


SYSTEM_PROMPT = (
    "You are an agentic planner. For each user request:\n"
    "\n"
    "1. Plan exactly 3 concrete steps and call `set_steps` ONCE with all "
    "three steps in a single call. Use the appropriate status for each "
    '(typically `"completed"` for all three when the plan is fully '
    "specified, or a mix of statuses for in-progress work — but always "
    "emit ALL three steps in a single call).\n"
    "2. Send ONE final conversational assistant message summarizing the "
    "plan, then stop. Do NOT call set_steps again.\n"
    "\n"
    "Rules: ONE set_steps call total — never call it twice. Never call "
    "tools in parallel. After the single set_steps call you MUST send a "
    "final assistant message and terminate.\n"
    "\n"
    "Why one call: the frontend renders state.steps as a single live "
    "card; one all-at-once update keeps the UX consistent and the "
    "agent-loop deterministic. Iterating set_steps multiple times "
    "(e.g. pending → in_progress → completed transitions) is "
    "non-deterministic against fixture-driven test runs and adds "
    "supersteps that can blow the recursion limit on flaky LLM responses."
)


# Worst-case supersteps for a clean run: 1 set_steps + 1 final message + a
# few LangGraph plumbing supersteps = ~5. Keeping recursion_limit=50 as
# generous headroom that should never be hit when the LLM follows the
# single-set_steps-call instruction.
graph = create_agent(
    model=init_chat_model(
        "openai:gpt-4o-mini", temperature=0, use_responses_api=False
    ),
    tools=[set_steps],
    system_prompt=SYSTEM_PROMPT,
    state_schema=GenUiAgentState,
    middleware=[CopilotKitMiddleware()],
).with_config({"recursion_limit": 50})
