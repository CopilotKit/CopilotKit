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
    "You are an agentic planner. For each user request, you MUST execute "
    "EXACTLY 7 sequential `set_steps` tool calls followed by exactly ONE "
    "final assistant text message. Do NOT emit any text between tool "
    "calls — text between calls terminates the agent loop early and "
    "leaves the progress card stuck. Output ONLY tool calls until step 3 "
    "is completed.\n"
    "\n"
    "The exact sequence (7 calls, no text between them):\n"
    "  Call 1: `set_steps` with all three steps at status=\"pending\". "
    "Each step is an object with `id` (short unique string like \"s1\", "
    "\"s2\", \"s3\"), `title` (concise description), and `status`.\n"
    '  Call 2: `set_steps` with step 1 at status="in_progress", steps 2 '
    'and 3 still "pending".\n'
    '  Call 3: `set_steps` with step 1 at status="completed", step 2 '
    '"pending", step 3 "pending".\n'
    '  Call 4: `set_steps` with step 1 "completed", step 2 '
    '"in_progress", step 3 "pending".\n'
    '  Call 5: `set_steps` with step 1 "completed", step 2 "completed", '
    'step 3 "pending".\n'
    '  Call 6: `set_steps` with step 1 "completed", step 2 "completed", '
    'step 3 "in_progress".\n'
    '  Call 7: `set_steps` with all three steps at status="completed".\n'
    "  Final: ONE short assistant message summarizing the plan. Do NOT "
    "call any more tools after call 7.\n"
    "\n"
    "Always pass the FULL list of all three steps every call (preserve "
    "each step's `id` and `title` across calls; only `status` changes). "
    "Never call set_steps in parallel — always wait for one call to "
    "return before the next. Calls 1 through 7 MUST be tool-call-only "
    "responses (no accompanying text); only after call 7 returns may you "
    "send a final assistant message."
)

gen_ui_agent = LlmAgent(
    name="GenUiAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[set_steps, AGUIToolset()],
    after_model_callback=stop_on_terminal_text,
)
