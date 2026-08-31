"""Agno agent backing the gen-ui-agent (Agentic Generative UI) demo.

Mirrors `langgraph-python/src/agents/gen_ui_agent.py` and
`ms-agent-python/src/agents/gen_ui_agent.py`. The agent plans a task as
3 steps and walks each `pending` -> `in_progress` -> `completed`,
calling `set_steps` after every transition. The frontend
(`src/app/demos/gen-ui-agent/page.tsx`) subscribes to
`agent.state.steps` via `useAgent({ updates: [OnStateChanged] })` and
renders a live progress card.

State shape (mirrors LGP `GenUiAgentState.steps`):

    {
      "steps": [
        {"id": "...", "title": "...",
         "status": "pending" | "in_progress" | "completed"},
        ...
      ]
    }

Wiring: this agent is mounted via `_attach_state_aware_route` in
`agent_server.py` at `/gen-ui-agent/agui`. That custom router emits a
`StateSnapshotEvent` carrying the final `session_state` immediately
before the closing `RunFinishedEvent`, which is what makes the agent's
state writes visible to the UI's `useAgent({ updates: [OnStateChanged] })`
subscription. Stock Agno AGUI does NOT emit STATE_SNAPSHOT — same
pattern as `shared_state_read_write` and `subagents`.
"""

from __future__ import annotations

from textwrap import dedent

import dotenv
from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.run import RunContext

dotenv.load_dotenv()


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
    to return before the next. Always include the FULL list of steps
    on each call (set_steps replaces the steps array, it does not
    append). After all three steps are completed you MUST send a final
    assistant message and terminate.
    """
).strip()


def set_steps(run_context: RunContext, steps: list[dict]) -> str:
    """Publish the current plan + step statuses to shared state.

    Always pass the FULL list of steps (every step with `id`, `title`,
    and `status` ∈ {'pending', 'in_progress', 'completed'}). This call
    REPLACES `session_state["steps"]` — the custom AGUI router in
    `agent_server.py` then emits a `StateSnapshotEvent` carrying the
    new state, which the frontend's `useAgent` subscription picks up
    and renders as the live progress card.
    """
    if run_context.session_state is None:
        run_context.session_state = {}
    # Tolerate stray non-dict entries (defensive: avoid serialization
    # crashes mid-stream if the model emits something off-shape).
    cleaned: list[dict] = []
    for s in steps or []:
        if isinstance(s, dict):
            cleaned.append(s)
    run_context.session_state["steps"] = cleaned
    return f"Published {len(cleaned)} step(s)."


agent = Agent(
    model=OpenAIChat(id="gpt-4o-mini", timeout=120),
    tools=[set_steps],
    instructions=SYSTEM_PROMPT,
    description=(
        "Plans 3 steps and walks each pending -> in_progress -> completed "
        "via set_steps. Drives the gen-ui-agent demo's live progress card."
    ),
    # 3 steps * 2 transitions + 1 initial enumeration = 7 expected calls;
    # give a small headroom for retries while bounding runaway loops.
    tool_call_limit=12,
)
