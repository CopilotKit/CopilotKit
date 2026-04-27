"""Agent backing the Agentic Generative UI (gen-ui-agent) demo.

The agent plans a task as a list of steps and walks each step pending ->
completed via a `set_steps` tool that writes into ADK session state under
`steps`. The frontend reads `agent.state.steps` and renders a TaskProgress
card. Mirrors langgraph-python's gen_ui_agent.py.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

def set_steps(tool_context: ToolContext, steps: list[dict]) -> dict:
    """Publish the current plan + step statuses.

    Call this every time a step transitions (including the first enumeration
    of all steps). Each step is an object with `description` and `status`
    where status is one of "pending" or "completed".
    """
    tool_context.state["steps"] = steps
    return {"status": "ok", "step_count": len(steps)}

_INSTRUCTION = (
    "You are an agentic planner. For each user request:\n"
    "(1) Plan exactly the requested number of concrete steps, then call "
    "`set_steps` ONCE with all of them set to status='pending'.\n"
    "(2) For each step in order, simulate the work briefly, then call "
    "`set_steps` with that step (and all earlier steps) flipped to "
    "status='completed'. Always pass the FULL list of steps every call.\n"
    "(3) After every step is completed, respond conversationally with a "
    "short summary.\n"
    "Never call set_steps in parallel — wait for one call to return before "
    "the next."
)

gen_ui_agent = LlmAgent(
    name="GenUiAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[set_steps],
)
