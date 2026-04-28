"""Agent backing the In-Chat Human in the Loop demo.

Mirrors the existing google-adk hitl/ demo's pattern: the agent calls a
`generate_task_steps` tool whose execution the frontend resolves via
useHumanInTheLoop({ render }) — the user picks/approves steps in the chat
and `respond({...})` is forwarded back to the agent as the tool result.

Backend tool body simply emits a placeholder dict; the real work happens
on the frontend (the renderer waits for user input and resolves the call).
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext


def generate_task_steps(tool_context: ToolContext, steps: list[dict]) -> dict:
    """Generate a list of steps for the user to review.

    Each step has `description: str` and `status: "enabled" | "disabled" |
    "executing"`. Always emit each step initially with status="enabled".
    The frontend renders the steps as an inline approval UI; the user
    enables/disables/confirms and `respond({...})` is forwarded back as
    this tool's result.
    """
    return {
        "status": "pending_human_decision",
        "step_count": len(steps),
    }


_INSTRUCTION = (
    "You are a planning assistant. When the user asks you to plan something, "
    "always call generate_task_steps with the proposed list of steps (each "
    "with description + status='enabled'). The frontend will render the "
    "steps inline and the user will confirm or reject — your job is to plan "
    "and call the tool, then summarise the user's decision once they "
    "respond."
)

hitl_in_chat_agent = LlmAgent(
    name="HitlInChatAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[generate_task_steps],
)
