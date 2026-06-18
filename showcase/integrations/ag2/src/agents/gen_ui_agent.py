"""gen-ui-agent — minimal AG2 agent with explicit `steps` state schema.

Mirrors `langgraph-python/src/agents/gen_ui_agent.py` and
`ms-agent-python/src/agents/gen_ui_agent.py`. The frontend
(`src/app/demos/gen-ui-agent/page.tsx`) subscribes to
`agent.state.steps` via `useAgent` and renders a live progress card; the
backend's job is to plan exactly 3 steps and walk each
pending -> in_progress -> completed by calling the `set_steps` tool.
Every call to `set_steps` returns a `ReplyResult` whose
`context_variables` carry the updated `steps` array, which AG2's
`AGUIStream` surfaces back to the UI as a state snapshot so the
progress card re-renders in-place after every transition.

State shape (mirrors LGP `GenUiAgentState.steps`):
    [
      {"id": "...", "title": "...", "status": "pending" | "in_progress" | "completed"},
      ...
    ]

AG2 specifics:
- Uses `ContextVariables` + `ReplyResult` (same mechanism as
  `shared_state_read_write.py`) to publish state. AG2's AG-UI adapter
  emits a STATE_SNAPSHOT event after every `ReplyResult` so the
  frontend sees the full `steps` list on each `set_steps` call.
- Mounts a dedicated FastAPI sub-app so this demo gets its own
  ContextVariables slot, isolated from the shared default agent.
"""

import logging
from textwrap import dedent
from typing import Annotated, List

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from autogen.agentchat import ContextVariables, ReplyResult
from autogen.tools import tool
from fastapi import FastAPI

logger = logging.getLogger(__name__)


@tool()
async def set_steps(
    context_variables: ContextVariables,
    steps: Annotated[
        List[dict],
        (
            "The complete source of truth for the plan: every step "
            "with `id`, `title`, and `status` ('pending' | "
            "'in_progress' | 'completed'). Always include the FULL "
            "list on every call, never a diff."
        ),
    ],
) -> ReplyResult:
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
    context_variables.update({"steps": cleaned})
    return ReplyResult(
        message=f"Published {len(cleaned)} step(s).",
        context_variables=context_variables,
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


agent = ConversableAgent(
    name="gen_ui_agent",
    system_message=SYSTEM_PROMPT,
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    # Nominal cost is ~7 set_steps cycles + 1 final model turn.
    # 15 gives ~2x headroom for retries inside the LLM loop while still
    # bounding pathological runaway behavior (Railway log-rate limits).
    max_consecutive_auto_reply=15,
    functions=[set_steps],
)

stream = AGUIStream(agent)
gen_ui_agent_app = FastAPI()
gen_ui_agent_app.mount("", stream.build_asgi())
