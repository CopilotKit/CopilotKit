"""LangGraph agent for the Interrupt-based Generative UI demo.

Defines a backend tool `ask_confirmation(message, details)` that uses
langgraph's `interrupt()` primitive to pause the run and surface a
confirmation payload to the frontend. The frontend `useInterrupt`
renderer receives `event.value == {message, details}` and resolves with
`{approved: bool}` to resume the graph.
"""

from __future__ import annotations

from typing import Any, Optional

from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.types import interrupt
from copilotkit import CopilotKitMiddleware


SYSTEM_PROMPT = (
    "You are a confirmation assistant. Whenever the user asks you to perform "
    "ANY action (book a flight, delete an account, send an email, schedule a "
    "meeting, etc.) you MUST call the `ask_confirmation` tool first to get "
    "user approval before claiming the action has been performed. "
    "Pass a clear human-readable `message` describing what you're about to do, "
    "and include any relevant structured data in `details` (e.g. "
    "`{\"from\": \"SFO\", \"to\": \"JFK\"}`). "
    "After the tool returns, reply briefly acknowledging whether the action "
    "was approved or cancelled."
)


@tool
def ask_confirmation(message: str, details: Optional[dict] = None) -> str:
    """Pause the agent and ask the user to approve or cancel the pending action.

    Args:
        message: Short human-readable description of what's about to happen.
        details: Optional structured payload (e.g. {"from": "SFO", "to": "JFK"})
            to render alongside the confirmation card.

    Returns:
        A short string indicating whether the user approved or cancelled.
    """
    # langgraph's `interrupt()` pauses execution and forwards the payload to
    # the client. The CopilotKit runtime bridges that into an `on_interrupt`
    # custom event, which the frontend v2 `useInterrupt` hook picks up.
    response = interrupt({"message": message, "details": details or {}})

    # The frontend `resolve(...)` value comes back here. Our demo renderer
    # resolves with `{approved: bool}`, but be defensive for other shapes.
    approved = False
    if isinstance(response, dict):
        approved = bool(response.get("approved"))
    elif isinstance(response, bool):
        approved = response
    elif isinstance(response, str):
        approved = response.strip().lower() in {"yes", "y", "true", "approve", "approved"}

    if approved:
        return f"User approved. Action completed: {message}"
    return f"User cancelled. Action NOT performed: {message}"


model = ChatOpenAI(model="gpt-4o-mini")

graph = create_agent(
    model=model,
    tools=[ask_confirmation],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
