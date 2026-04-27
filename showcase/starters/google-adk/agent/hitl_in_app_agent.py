"""Agent backing the In-App Human in the Loop demo.

The agent has no backend tools — the frontend registers `request_approval`
via useFrontendTool with an async handler. The handler opens an app-level
modal OUTSIDE the chat, waits for the user to click Approve / Reject, then
resolves the pending tool Promise. The agent gets the user's decision back
as the tool result.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent

_INSTRUCTION = (
    "You are an approval-flow assistant. Whenever you propose an action "
    "that needs human sign-off (booking a meeting, charging an account, "
    "deleting a record, etc.), call the `request_approval` frontend tool "
    "with a clear summary of what you propose and why. Wait for the tool "
    "to return — its result is the user's decision (accepted / rejected, "
    "with optional reason). Only proceed if accepted. Keep your messages "
    "concise."
)

hitl_in_app_agent = LlmAgent(
    name="HitlInAppAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[],
)
