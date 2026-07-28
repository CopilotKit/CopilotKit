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

from collections.abc import AsyncGenerator
from textwrap import dedent
from typing import Annotated, Any

from ag_ui.core import BaseEvent
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
    # Empty tool-result text: non-empty "Published N step(s)." was
    # rendering as extra chat bubbles and starving the harness
    # 1-bubble-per-turn settle gate by pill 3.
    return state_update(
        text="",
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


def _has_tool_calls(message: dict[str, Any]) -> bool:
    tool_calls = message.get("tool_calls") or message.get("toolCalls") or []
    return isinstance(tool_calls, list) and len(tool_calls) > 0


def _last_user_message_index(messages: list[dict[str, Any]]) -> int:
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") == "user":
            return index
    return -1


def _drop_historical_tool_messages(messages: Any) -> list[dict[str, Any]]:
    """Drop completed tool-call history before the current user turn.

    Same pattern as beautiful_chat: the D6 probe runs three pills in one
    browser session. Without this, prior pills' set_steps toolCallIds
    remain in the message list and aimock first-match can chain the wrong
    fixture. Combined with unique call_d6_msap_* toolCallIds in the MS
    fixtures, each pill's ReAct chain stays isolated.
    """
    if not isinstance(messages, list):
        return []

    typed = [m for m in messages if isinstance(m, dict)]
    last_user = _last_user_message_index(typed)
    clean: list[dict[str, Any]] = []
    for index, message in enumerate(typed):
        if index < last_user:
            if message.get("role") == "tool":
                continue
            if message.get("role") == "assistant" and _has_tool_calls(message):
                continue
        clean.append(message)
    return clean


class GenUiFrameworkAgent(AgentFrameworkAgent):
    """Scope tool-result history to the active pill turn."""

    async def run(  # type: ignore[override]
        self,
        input_data: dict[str, Any],
    ) -> AsyncGenerator[BaseEvent, None]:
        patched = dict(input_data)
        patched["messages"] = _drop_historical_tool_messages(
            input_data.get("messages")
        )
        async for event in super().run(patched):
            yield event


def create_gen_ui_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the gen-ui-agent MAF agent."""
    base_agent = Agent(
        client=chat_client,
        name="gen_ui_agent",
        instructions=SYSTEM_PROMPT,
        tools=[set_steps],
    )

    # NB: `predict_state_config` (predictive streaming from LLM tool-call arg
    # deltas) is intentionally omitted. `agent_framework_ag_ui._orchestration
    # ._predictive_state.PredictiveStateHandler` emits StateDeltaEvents using
    # JSON Patch `op: "replace"` against `/<state_key>`. When the run starts
    # with `current_state = {}`, the very first StateDelta tries to replace
    # `/steps` — a path that doesn't exist — and the browser-side patch
    # application throws `OPERATION_PATH_UNRESOLVABLE`. `state_update()`
    # inside `set_steps` already emits a full `StateSnapshotEvent` after
    # every tool call.
    return GenUiFrameworkAgent(
        agent=base_agent,
        name="GenUiAgent",
        description=(
            "Plans 3 steps and walks each pending → in_progress → "
            "completed via set_steps. Drives the `gen-ui-agent` demo's "
            "live progress card."
        ),
        # state_schema intentionally omitted: state_update() in set_steps
        # emits full StateSnapshotEvents; an empty schema seed was not
        # required for pills 1–2 and can interfere with multi-pill runs.
        require_confirmation=False,
    )
