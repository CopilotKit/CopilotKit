"""LangGraph agent for the Interrupt-based Generative UI demo.

Defines a backend tool `schedule_meeting(topic, attendee)` that uses
langgraph's `interrupt()` primitive to pause the run and surface the
meeting context to the frontend. The frontend `useInterrupt` renderer
shows a time picker and resolves with `{chosen_time, chosen_label}` or
`{cancelled: true}`, which this tool turns into a human-readable result.
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

# @region[backend-interrupt-tool]
@tool
def schedule_meeting(topic: str, attendee: Optional[str] = None) -> str:
    """Ask the user to pick a time slot for a call, via an in-chat picker.

    Args:
        topic: Short human-readable description of the call's purpose.
        attendee: Who the call is with (optional).

    Returns:
        Human-readable result string describing the chosen slot or
        indicating the user cancelled.
    """
    # langgraph's `interrupt()` pauses execution and forwards the payload to
    # the client. The frontend v2 `useInterrupt` hook renders the picker and
    # calls `resolve(...)` with the user's selection, which comes back here.
    response: Any = interrupt({"topic": topic, "attendee": attendee})

    if isinstance(response, dict):
        if response.get("cancelled"):
            return f"User cancelled. Meeting NOT scheduled: {topic}"
        chosen_label = response.get("chosen_label") or response.get("chosen_time")
        if chosen_label:
            return f"Meeting scheduled for {chosen_label}: {topic}"

    return f"User did not pick a time. Meeting NOT scheduled: {topic}"
# @endregion[backend-interrupt-tool]

model = ChatOpenAI(model="gpt-4o-mini")

graph = create_agent(
    model=model,
    tools=[schedule_meeting],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
