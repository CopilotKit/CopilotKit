"""gen-ui-agent — minimal MAF agent with explicit `steps` state schema.

Mirrors LangGraph's `langgraph-python/src/agents/gen_ui_agent.py`. The
frontend (`src/app/demos/gen-ui-agent/page.tsx`) subscribes to
`agent.state.steps` via `useAgent` and renders a live progress card; the
backend's job is to plan exactly 3 steps and walk each pending →
in_progress → completed by calling the `set_steps` tool. Every call
to `set_steps` triggers a `state_update` so the UI re-renders
in-place.

State shape (mirrors LGP `GenUiAgentState.steps`):
    [
      {"id": "...", "title": "...", "status": "pending" | "in_progress" | "completed"},
      ...
    ]
"""

from __future__ import annotations

import json
from textwrap import dedent
from typing import Annotated

from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent, state_update
from pydantic import Field


STATE_SCHEMA: dict[str, object] = {
    "steps": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "title": {"type": "string"},
                "status": {
                    "type": "string",
                    "enum": ["pending", "in_progress", "completed"],
                },
            },
        },
        "description": "Ordered list of plan steps with live status.",
    }
}

PREDICT_STATE_CONFIG: dict[str, dict[str, str]] = {
    "steps": {
        "tool": "set_steps",
        "tool_argument": "steps",
    }
}


@tool(
    name="set_steps",
    description=(
        "Publish the current plan and step statuses. Call this every "
        "time a step transitions (including the first enumeration of "
        "steps). Always include the full list of steps on each call."
    ),
)
def set_steps(
    steps: Annotated[
        list[dict],
        Field(
            description=(
                "The complete source of truth for the plan: every step "
                "with `id`, `title`, and `status` ('pending' | "
                "'in_progress' | 'completed')."
            )
        ),
    ],
):
    """Persist the current plan + statuses to shared state.

    Uses `state_update()` (MAF equivalent of LangGraph's
    `Command(update={"steps": [...]})`) so the frontend's progress card
    re-renders with the new statuses after every transition.
    """
    return state_update(
        text=f"Published {len(steps)} step(s).",
        state={"steps": steps},
    )


SYSTEM_PROMPT = dedent(
    """
    You are an agentic planner. For each user request, follow this exact
    sequence:
    1. Plan exactly 3 concrete steps and call `set_steps` ONCE with all
       three steps at status="pending".
    2. Step 1: call `set_steps` with step 1 at status="in_progress",
       then call `set_steps` again with step 1 at status="completed".
    3. Step 2: call `set_steps` with step 2 at status="in_progress",
       then call `set_steps` again with step 2 at status="completed".
    4. Step 3: call `set_steps` with step 3 at status="in_progress",
       then call `set_steps` again with step 3 at status="completed".
    5. Send ONE final conversational assistant message summarizing the
       plan, then stop. Do not call any more tools after step 3 is
       completed.

    Rules: never call set_steps in parallel — always wait for one call
    to return before the next. After all three steps are completed you
    MUST send a final assistant message and terminate.
    """
).strip()


def create_gen_ui_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the gen-ui-agent MAF agent."""
    base_agent = Agent(
        client=chat_client,
        name="gen_ui_agent",
        instructions=SYSTEM_PROMPT,
        tools=[set_steps],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="GenUiAgent",
        description=(
            "Plans 3 steps and walks each pending → in_progress → "
            "completed via set_steps. Drives the `gen-ui-agent` demo's "
            "live progress card."
        ),
        predict_state_config=PREDICT_STATE_CONFIG,
        require_confirmation=False,
    )
