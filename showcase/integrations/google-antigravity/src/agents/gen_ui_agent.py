"""gen-ui-agent: the agent plans a step list and walks it, the UI renders it live.

``set_steps`` is a server tool that writes the ``steps`` slot of shared
state with the adapter's ``experimental_set_state()``. Each call streams a
STATE_SNAPSHOT, so the page's progress card (``useAgent`` on
``state.steps``) updates after every transition, as the reference's
``Command(update={"steps": ...})`` does.

No ``from __future__ import annotations``: the SDK derives the tool schema
from the live annotations.
"""

from ag_ui_antigravity import experimental_get_state, experimental_set_state

from agents._common import build

# Same prompt as langgraph-python's gen_ui_agent.py.
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
    "return before the next. After all three steps are completed you MUST "
    "send a final assistant message and terminate."
)


# @region[gen-ui-agent-state-tool]
def set_steps(steps: list[dict]) -> str:
    """Publish the current plan + step statuses. Call this every time a step
    transitions (including the first enumeration of steps).

    Each step has: id, title, and status ("pending", "in_progress" or
    "completed").
    """
    experimental_set_state({**experimental_get_state(), "steps": steps})
    return f"Published {len(steps)} step(s)."


# @endregion[gen-ui-agent-state-tool]


def gen_ui_agent():
    return build(system_instructions=SYSTEM_PROMPT, tools=[set_steps])
