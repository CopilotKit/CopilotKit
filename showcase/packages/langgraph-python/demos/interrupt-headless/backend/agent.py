"""LangGraph agent for the Headless Interrupt cell.

Shares the same interrupt primitive as `gen-ui-interrupt` — a `schedule_meeting`
tool that uses langgraph's `interrupt()` to pause and surface a payload to the
client. The frontend for this cell demonstrates resolving that interrupt from a
plain headless button grid (no chat UI), using agent event subscription +
`copilotkit.runAgent` directly instead of `useInterrupt`'s in-chat renderer.
"""

from __future__ import annotations

from typing import Any, Optional

from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.types import interrupt
from copilotkit import CopilotKitMiddleware


SYSTEM_PROMPT = (
    "You are a scheduling assistant. Whenever the user asks you to book a "
    "call / schedule a meeting, you MUST call the `schedule_meeting` tool. "
    "Pass a short `topic` describing the purpose and `attendee` describing "
    "who the meeting is with. After the tool returns, confirm briefly "
    "whether the meeting was scheduled and at what time, or that the user "
    "cancelled."
)


@tool
def schedule_meeting(topic: str, attendee: Optional[str] = None) -> str:
    """Ask the user to pick a time slot for a call, via an in-app picker.

    Args:
        topic: Short human-readable description of the call's purpose.
        attendee: Who the call is with (optional).

    Returns:
        Human-readable result string describing the chosen slot or
        indicating the user cancelled.
    """
    # langgraph's `interrupt()` pauses execution and forwards the payload to
    # the client. The headless frontend subscribes to the on_interrupt custom
    # event on the agent, stores it in local state, and resumes the run via
    # `copilotkit.runAgent({ forwardedProps: { command: { resume, ... } } })`.
    response: Any = interrupt({"topic": topic, "attendee": attendee})

    if isinstance(response, dict):
        if response.get("cancelled"):
            return f"User cancelled. Meeting NOT scheduled: {topic}"
        chosen_label = response.get("chosen_label") or response.get("chosen_time")
        if chosen_label:
            return f"Meeting scheduled for {chosen_label}: {topic}"

    return f"User did not pick a time. Meeting NOT scheduled: {topic}"


model = ChatOpenAI(model="gpt-4o-mini")

graph = create_agent(
    model=model,
    tools=[schedule_meeting],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
