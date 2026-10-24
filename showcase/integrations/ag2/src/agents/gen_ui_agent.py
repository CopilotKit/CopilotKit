"""gen-ui-agent — minimal AG2 agent with explicit `steps` state schema.

Mirrors `langgraph-python/src/agents/gen_ui_agent.py` and
`ms-agent-python/src/agents/gen_ui_agent.py`. The frontend
(`src/app/demos/gen-ui-agent/page.tsx`) subscribes to
`agent.state.steps` via `useAgent` and renders a live progress card; the
backend's job is to plan exactly 3 steps and walk each
pending -> in_progress -> completed by calling the `set_steps` tool.
Every call to `set_steps` writes the updated `steps` array into the run's
variables and publishes a state snapshot, so the progress card re-renders
in-place after every transition.

State shape (mirrors LGP `GenUiAgentState.steps`):
    [
      {"id": "...", "title": "...", "status": "pending" | "in_progress" | "completed"},
      ...
    ]

AG2 specifics:
- State lives in the run's variables (`ctx.variables`), which `AGUIStream`
  maps to and from AG-UI state. `publish_state` (see `_state.py`) sends a
  STATE_SNAPSHOT mid-run so the frontend sees the full `steps` list on each
  `set_steps` call.
- Mounts a dedicated FastAPI sub-app so this demo gets its own agent,
  isolated from the shared default agent.
"""

import logging
from textwrap import dedent
from typing import Annotated, List

from ag2 import Agent, Context, tool
from ag2.ag_ui import AGUIStream
from ag2.config.openai import OpenAIResponsesConfig
from fastapi import FastAPI
from pydantic import Field

from ._state import publish_state

logger = logging.getLogger(__name__)


@tool
async def set_steps(
    ctx: Context,
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
    ctx.variables["steps"] = cleaned
    await publish_state(ctx)
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
    "gen_ui_agent",
    prompt=SYSTEM_PROMPT,
    config=OpenAIResponsesConfig(model="gpt-5-mini", streaming=True),
    tools=[set_steps],
)

stream = AGUIStream(agent)
gen_ui_agent_app = FastAPI()
gen_ui_agent_app.mount("", stream.build_asgi())
