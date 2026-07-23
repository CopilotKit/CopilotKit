"""CrewAI Flow backing the `gen-ui-agent` demo.

Mirrors `langgraph-python/src/agents/gen_ui_agent.py` and
`ms-agent-python/src/agents/gen_ui_agent.py`, implemented as a
`crewai.flow.Flow` so we own the LLM call, tool schema, and state
mutations directly. The shared `LatestAiDevelopment` crew on "/" cannot
host this demo: `ChatWithCrewFlow` does not surface per-tool state
mutations to the AG-UI bridge — its only state mutation is appending
`result.raw` to `state["outputs"]` when the model invokes the special
`<crew_name>` tool.

Same backend strategy used by `shared_state_read_write.py` and
`subagents.py`: a dedicated CrewAI Flow mounted at its own path via
`add_crewai_flow_fastapi_endpoint`, calling
`copilotkit_emit_state(self.state)` after each tool execution so the
AG-UI bridge emits a STATE_SNAPSHOT event the UI's
`useAgent({updates: [OnStateChanged]})` subscription consumes.

Contract (probe harness/src/probes/scripts/d5-gen-ui-agent.ts):
- The agent plans exactly 3 steps and walks each pending →
  in_progress → completed.
- Every transition is published via `set_steps(steps=[...])` and
  emitted as a STATE_SNAPSHOT.
- The frontend renders `[data-testid="agent-state-card"]` and one
  `[data-testid="agent-step"]` per `state.steps[i]`.
"""

from __future__ import annotations

import json
import uuid
from typing import List, Literal, Optional

from crewai.flow.flow import Flow, start
from litellm import acompletion
from pydantic import BaseModel, Field

from ag_ui_crewai import CopilotKitState, copilotkit_emit_state, copilotkit_stream


# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------


class Step(BaseModel):
    """One step in the gen-ui-agent plan.

    Mirrors LangGraph's `GenUiAgentState.steps[i]` typed dict and MAF's
    `STATE_SCHEMA.steps.items`. `id` is a stable opaque handle so the
    frontend can keep React keys stable across status transitions.
    """

    id: str = ""
    title: str = ""
    status: Literal["pending", "in_progress", "completed"] = "pending"


class AgentState(CopilotKitState):
    """Agent state with a typed `steps` list.

    The frontend (`src/app/demos/gen-ui-agent/page.tsx`) subscribes via
    `useAgent({updates: [OnStateChanged]})` and reads
    `agent.state.steps`. The `InlineAgentStateCard` paints one row per
    step keyed by `id`.
    """

    steps: List[Step] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Tool schema (LiteLLM/OpenAI tool format)
# ---------------------------------------------------------------------------

# Plain OpenAI-compatible tool schema rather than a CrewAI `BaseTool`.
# The supervising LLM call goes through `litellm.acompletion` directly,
# so a JSON-schema tool definition is the right primitive (matches
# `shared_state_read_write.SET_NOTES_TOOL`).
SET_STEPS_TOOL = {
    "type": "function",
    "function": {
        "name": "set_steps",
        "description": (
            "Publish the current plan and step statuses. Call this every "
            "time a step transitions (including the first enumeration of "
            "steps). Always include the FULL list of steps on each call "
            "(this is the complete source of truth — not a diff)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "steps": {
                    "type": "array",
                    "description": ("Ordered list of plan steps with live status."),
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
                        "required": ["id", "title", "status"],
                    },
                }
            },
            "required": ["steps"],
        },
    },
}


# ---------------------------------------------------------------------------
# Flow
# ---------------------------------------------------------------------------


SYSTEM_PROMPT = (
    "You are an agentic planner. For each user request, follow this exact "
    "sequence:\n"
    "1. Plan exactly 3 concrete steps and call `set_steps` ONCE with all "
    'three steps at status="pending".\n'
    '2. Step 1: call `set_steps` with step 1 at status="in_progress", '
    'then call `set_steps` again with step 1 at status="completed".\n'
    '3. Step 2: call `set_steps` with step 2 at status="in_progress", '
    'then call `set_steps` again with step 2 at status="completed".\n'
    '4. Step 3: call `set_steps` with step 3 at status="in_progress", '
    'then call `set_steps` again with step 3 at status="completed".\n'
    "5. Send ONE final conversational assistant message summarizing the "
    "plan, then stop. Do not call any more tools after step 3 is "
    "completed.\n"
    "\n"
    "Rules: never call set_steps in parallel — always wait for one call to "
    "return before the next. Always pass the FULL list of steps on every "
    "call (existing steps with updated status, NOT a diff). Each step's "
    "`id` MUST stay stable across the lifetime of the plan. After all "
    "three steps are completed you MUST send a final assistant message "
    "and terminate."
)


def _coerce_steps(raw: object) -> List[Step]:
    """Parse the model's `set_steps(steps=...)` payload into typed `Step`s.

    Defensive: drops malformed entries (non-dict, missing required keys,
    bad status enum) rather than raising — a single bad row should not
    blow up the whole flow. The remaining good rows still drive the UI.
    """
    if not isinstance(raw, list):
        return []
    out: List[Step] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        step_id = entry.get("id")
        title = entry.get("title")
        status = entry.get("status")
        if not isinstance(step_id, str) or not step_id:
            continue
        if not isinstance(title, str):
            continue
        if status not in ("pending", "in_progress", "completed"):
            continue
        out.append(Step(id=step_id, title=title, status=status))
    return out


class GenUiAgentFlow(Flow[AgentState]):
    """Chat flow with a tool-execution loop that drives `state.steps`.

    Mirrors the LangGraph reference's ReAct loop: each turn the LLM
    either calls `set_steps` (which we execute, replace `state.steps`,
    emit a STATE_SNAPSHOT, and loop back) or emits a final assistant
    message (which terminates the turn).
    """

    # Maximum number of LLM round-trips per user turn. The nominal
    # script is 1 enumeration + 3 × 2 transitions + 1 final text = 8
    # iterations; `_MAX_ITERATIONS=20` gives ~2.5× headroom for the
    # model retrying tool-call formatting, parity with the LangGraph
    # reference's `recursion_limit=50` heuristic (~3× nominal).
    _MAX_ITERATIONS = 20

    @start()
    async def chat(self) -> None:
        system_message = {
            "role": "system",
            "content": SYSTEM_PROMPT,
            "id": str(uuid.uuid4()) + "-system",
        }

        # Frontend-registered actions + our backend `set_steps` tool.
        # The frontend's `useAgent` cell may register additional client
        # tools in the future — surface them to the LLM via
        # `self.state.copilotkit.actions`, same convention as
        # `shared_state_read_write.py`.
        tools = [
            *self.state.copilotkit.actions,
            SET_STEPS_TOOL,
        ]

        for _iteration in range(self._MAX_ITERATIONS):
            messages = [system_message, *self.state.messages]

            response = await copilotkit_stream(
                await acompletion(
                    model="openai/gpt-4o-mini",
                    messages=messages,
                    tools=tools,
                    # Mirror the LangGraph reference's "never parallel"
                    # rule. The prompt also reinforces this — keeping
                    # both belts and suspenders since some providers
                    # ignore the param.
                    parallel_tool_calls=False,
                    stream=True,
                )
            )

            message = response.choices[0].message
            self.state.messages.append(message)

            tool_calls = message.get("tool_calls") or []
            if not tool_calls:
                # No tool calls — the LLM produced a text response.
                # We're done with this turn.
                return

            # Iterate ALL tool calls — `parallel_tool_calls=False` is
            # set on the LLM call but providers can still emit multiple
            # under certain conditions. Indexing `[0]` would silently
            # drop the rest, leaving an assistant `tool_calls` message
            # with no matching `role: "tool"` reply, which most chat
            # APIs reject on the next turn. (Same defensive pattern as
            # `shared_state_read_write.py`.)
            steps_changed = False
            for tool_call in tool_calls:
                tool_call_id = tool_call["id"]
                tool_name = tool_call["function"]["name"]

                if tool_name != "set_steps":
                    # Frontend-registered action: the AG-UI client owns
                    # the round-trip. We still need a placeholder tool
                    # result so the message thread stays valid.
                    self.state.messages.append(
                        {
                            "role": "tool",
                            "content": "frontend tool — handled client-side",
                            "tool_call_id": tool_call_id,
                        }
                    )
                    continue

                try:
                    args = json.loads(tool_call["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                new_steps = _coerce_steps(args.get("steps"))
                # Last-write-wins reducer (matches LangGraph's
                # `_last_steps` reducer and MAF's `state_update` shape).
                # Each `set_steps` call REPLACES the list rather than
                # appending — the probe asserts swap-not-accumulate
                # semantics (see d5-gen-ui-agent.ts).
                self.state.steps = new_steps
                steps_changed = True

                self.state.messages.append(
                    {
                        "role": "tool",
                        "content": f"Published {len(new_steps)} step(s).",
                        "tool_call_id": tool_call_id,
                    }
                )

            # Emit a state snapshot so the UI's
            # `useAgent({updates: [OnStateChanged]})` subscription fires
            # and the InlineAgentStateCard re-renders immediately
            # without waiting for the next turn. Only emit if steps
            # actually changed; pure frontend-tool turns don't mutate
            # shared state.
            if steps_changed:
                await copilotkit_emit_state(self.state)

            # Loop back to call the LLM again with the tool result
            # appended — the LLM will issue the next transition or the
            # final text response.


# Module-level singleton — `add_crewai_flow_fastapi_endpoint` deepcopies
# this per request, so initialisation cost is paid once at import time.
gen_ui_agent_flow = GenUiAgentFlow()
