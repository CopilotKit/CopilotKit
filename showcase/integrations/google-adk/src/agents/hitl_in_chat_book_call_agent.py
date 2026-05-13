"""ADK agent backing the In-Chat HITL (book_call) demo.

The `book_call` tool is defined on the frontend via `useHumanInTheLoop`, so
there is no backend tool implementation here — the frontend renders a time
picker, the user's choice is forwarded back to the agent as the tool result.

This mirrors the langgraph-python reference (hitl_in_chat_agent.py) but
adapted to ADK: ADK doesn't need an explicit tool stub on the backend for
frontend-defined tools — the ag-ui-adk middleware injects the frontend's
tool list at request time.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from ag_ui_adk import AGUIToolset

from agents.shared_chat import get_model, stop_on_terminal_text

_INSTRUCTION = (
    "You help users book an onboarding call with the sales team. "
    "When they ask to book a call, call the frontend-provided "
    "`book_call` tool with a short topic and the user's name. "
    "Keep any chat reply to one short sentence."
)

hitl_in_chat_book_call_agent = LlmAgent(
    name="HitlInChatBookCallAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[AGUIToolset()],
    after_model_callback=stop_on_terminal_text,
)
