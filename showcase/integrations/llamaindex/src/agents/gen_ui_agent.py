"""gen-ui-agent — minimal LlamaIndex agent with explicit `steps` state.

Mirrors `langgraph-python/src/agents/gen_ui_agent.py` and
`ms-agent-python/src/agents/gen_ui_agent.py`. The agent plans a task as
exactly 3 steps and walks each pending → in_progress → completed by
calling the `set_steps` backend tool. The frontend
(`src/app/demos/gen-ui-agent/page.tsx`) subscribes to `agent.state.steps`
via `useAgent` and renders a live progress card.

LlamaIndex mechanism:
``get_ag_ui_workflow_router`` stores the run's full state at
``ctx.store["state"]`` and emits a ``StateSnapshotWorkflowEvent`` after
every tool call. Mutating that dict in place from the tool is sufficient
to push the new ``steps`` to the UI on every transition — no custom
event emission required. This is the same pattern used by
``shared_state_read_write_agent.set_notes``.

NOTE: deliberately NO ``from __future__ import annotations`` here. The
future import stringifies ``set_steps``'s annotations; pydantic's
signature-derived tool model then fails to resolve ``Context`` /
``Annotated`` at schema-build time ("`set_steps` is not fully defined…
call `set_steps.model_rebuild()`"), erroring every run of this agent.
"""

import os
from typing import Annotated, Any

from llama_index.core.workflow import Context
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


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
    "Each step is an object with `id` (string), `title` (string), and "
    '`status` (one of "pending", "in_progress", "completed"). Always pass '
    "the FULL list of steps on every call — never a diff.\n"
    "\n"
    "Rules: never call set_steps in parallel — always wait for one call to "
    "return before the next. After all three steps are completed you MUST "
    "send a final assistant message and terminate."
)


# @region[set-steps-tool]
async def set_steps(
    ctx: Context,
    steps: Annotated[
        list[dict],
        "The COMPLETE source of truth for the plan: every step with `id`, "
        "`title`, and `status` ('pending' | 'in_progress' | 'completed'). "
        "Always pass the full list, never a diff.",
    ],
) -> str:
    """Publish the current plan + step statuses to shared state.

    Use this every time a step transitions (including the first
    enumeration of steps). The router emits a post-tool
    ``StateSnapshotWorkflowEvent`` so the UI's progress card re-renders
    in place after every call.
    """
    state: dict[str, Any] = await ctx.store.get("state", default={})
    # Mutate in place so the router's post-tool StateSnapshotWorkflowEvent
    # carries the new value to the UI.
    state["steps"] = list(steps)
    await ctx.store.set("state", state)
    return f"Published {len(steps)} step(s)."


# @endregion[set-steps-tool]


_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


gen_ui_agent_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1", **_openai_kwargs),
    frontend_tools=[],
    backend_tools=[set_steps],
    system_prompt=SYSTEM_PROMPT,
    initial_state={"steps": []},
)
