"""Agent backing the Agentic Generative UI (gen-ui-agent) demo.

The agent plans a task as a list of steps and walks each step
pending -> in_progress -> completed via a `set_steps` tool that writes into
ADK session state under `steps`. The frontend reads `agent.state.steps` and
renders a live InlineAgentStateCard. Mirrors langgraph-python's
gen_ui_agent.py — each step is `{id, title, status}` with status one of
"pending", "in_progress", or "completed".
"""

from __future__ import annotations

from ag_ui_adk import AGUIToolset
from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

from agents.shared_chat import get_model, stop_on_terminal_text


def set_steps(tool_context: ToolContext, steps: list[dict]) -> dict:
    """Publish the current plan + step statuses.

    Call this every time a step transitions (including the first enumeration
    of all steps). Each step is an object with `id`, `title`, and `status`
    where status is one of "pending", "in_progress", or "completed".
    """
    tool_context.state["steps"] = steps
    return {"status": "ok", "step_count": len(steps)}


_INSTRUCTION = (
    "You are an agentic planner. For each user request, follow this exact "
    "sequence:\n"
    "1. Plan exactly 3 concrete steps and call `set_steps` ONCE with all "
    'three steps at status="pending". Each step is an object with `id` '
    '(short unique string like "s1", "s2", "s3"), `title` (concise '
    "description of the step), and `status`.\n"
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
    "Always pass the FULL list of all three steps every call (preserving "
    "each step's `id` and `title` across calls; only `status` changes). "
    "Never call set_steps in parallel — always wait for one call to "
    "return before the next. After all three steps are completed you MUST "
    "send a final assistant message and terminate."
)

gen_ui_agent = LlmAgent(
    name="GenUiAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[set_steps, AGUIToolset()],
    after_model_callback=stop_on_terminal_text,
)
