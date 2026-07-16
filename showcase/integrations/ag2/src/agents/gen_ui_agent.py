"""gen-ui-agent — minimal AG2 agent with explicit `steps` state schema.

Mirrors `langgraph-python/src/agents/gen_ui_agent.py` and
`ms-agent-python/src/agents/gen_ui_agent.py`. The frontend
(`src/app/demos/gen-ui-agent/page.tsx`) subscribes to
`agent.state.steps` via `useAgent` and renders a live progress card; the
backend's job is to plan exactly 3 steps and walk each
pending -> in_progress -> completed by calling the `set_steps` tool.
Every call to `set_steps` writes the updated `steps` array into
`Context.variables` and explicitly sends an intermediate
`StateSnapshotEvent` through `context.send`, so the progress card
re-renders in-place after every transition.

State shape (mirrors LGP `GenUiAgentState.steps`):
    [
      {"id": "...", "title": "...", "status": "pending" | "in_progress" | "completed"},
      ...
    ]

AG2 specifics:
- Uses `Context.variables` (same mechanism as
  `shared_state_read_write.py`) to publish state. AG2 1.0's AG-UI adapter
  merges incoming `RunAgentInput.state` into the variables at run start
  and emits a STATE_SNAPSHOT automatically only at run end (if the
  variables changed), so `set_steps` sends its own snapshot after every
  mutation to keep the frontend's `steps` list live per call.
- Mounts a dedicated FastAPI sub-app so this demo gets its own
  state slot, isolated from the shared default agent.
"""

import logging
from textwrap import dedent
from typing import Annotated, List

from ag2 import Agent, Context, tool
from ag2.ag_ui import AGUIEvent, AGUIStream
from ag2.config import OpenAIConfig
from ag_ui.core import StateSnapshotEvent
from fastapi import FastAPI
from pydantic import Field

logger = logging.getLogger(__name__)


@tool
async def set_steps(
    context: Context,
    steps: Annotated[
        List[dict],
        Field(
            description=(
                "The complete source of truth for the plan: every step "
                "with `id`, `title`, and `status` ('pending' | "
                "'in_progress' | 'completed'). Always include the FULL "
                "list on every call, never a diff."
            )
        ),
    ],
) -> str:
    """Publish the current plan and step statuses.

    Call this every time a step transitions (including the first
    enumeration of steps). Always include the full list of steps on
    each call.
    """
    # Normalize: keep only the fields the UI consumes, in case the LLM
    # tacked on extras. Tolerant of missing fields so the agent doesn't
    # hard-fail mid-run.
    cleaned: list[dict] = []
    for step in steps or []:
        if not isinstance(step, dict):
            continue
        cleaned.append(
            {
                "id": str(step.get("id", "")),
                "title": str(step.get("title", step.get("description", ""))),
                "status": str(step.get("status", "pending")),
            }
        )
    context.variables.update({"steps": cleaned})
    # AG2 1.0 only snapshots state automatically at run end; emit an explicit
    # intermediate snapshot so the progress card updates on every transition.
    await context.send(AGUIEvent(StateSnapshotEvent(snapshot=dict(context.variables))))
    return f"Published {len(cleaned)} step(s)."


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

    Rules:
    - Never call set_steps in parallel — always wait for one call to
      return before the next.
    - Always pass the COMPLETE list of steps on every call (existing +
      updated), never a diff.
    - Each step needs `id` (stable string id like "step-1"), `title`
      (short human-readable description), and `status`
      ('pending' | 'in_progress' | 'completed').
    - After all three steps are completed you MUST send a final
      assistant message and terminate.
    """
).strip()


agent = Agent(
    name="gen_ui_agent",
    prompt=SYSTEM_PROMPT,
    config=OpenAIConfig(model="gpt-4o-mini", streaming=True),
    # Nominal cost is ~7 set_steps cycles + 1 final model turn. The 0.x
    # version capped runaway behavior with max_consecutive_auto_reply=15
    # (~2x headroom for retries); AG2 1.0 has no direct per-turn
    # auto-reply cap, so the system prompt's explicit termination rules
    # are the guard against pathological runaway (Railway log-rate limits).
    tools=[set_steps],
)

stream = AGUIStream(agent)
gen_ui_agent_app = FastAPI()
gen_ui_agent_app.mount("", stream.build_asgi())
