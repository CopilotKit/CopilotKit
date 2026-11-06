"""gen-ui-agent: the agent plans a step list and walks it, the UI renders it live.

``set_steps`` writes the ``steps`` slot of shared state through
``shared_state().update``. Each call streams a STATE_SNAPSHOT, so the
page's progress card (``useAgent`` on ``state.steps``) updates after every
transition, as the reference's ``Command(update={"steps": ...})`` does.
"""

from typing import Literal

from ag_ui_openai_agents import shared_state
from agents import Agent, ModelSettings, function_tool
from pydantic import BaseModel

from demo_agents._common import MODEL

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


class Step(BaseModel):
    id: str
    title: str
    status: Literal["pending", "in_progress", "completed"]


# @region[gen-ui-agent-state-tool]
@function_tool
def set_steps(steps: list[Step]) -> str:
    """Publish the current plan + step statuses. Call this every time a step
    transitions (including the first enumeration of steps).
    """
    shared_state().update(steps=[step.model_dump() for step in steps])
    return f"Published {len(steps)} step(s)."


# @endregion[gen-ui-agent-state-tool]


gen_ui_agent = Agent(
    name="planner",
    instructions=SYSTEM_PROMPT,
    model=MODEL,
    # One transition per model call, as the prompt asks.
    model_settings=ModelSettings(parallel_tool_calls=False),
    tools=[set_steps],
)
