"""LangGraph agent for the Human-in-the-Loop (Interrupt-based) booking demo.

Defines a backend tool `schedule_meeting(topic, attendee)` that uses
LangGraph's `interrupt()` primitive to pause the run and surface a
structured booking payload to the frontend. The frontend `useInterrupt`
renderer shows a time picker inline in the chat and resolves with
`{chosen_time, chosen_label}` or `{cancelled: true}`, which this tool
turns into a human-readable result the agent uses to confirm the booking.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

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


def _candidate_slots() -> List[dict]:
    """Generate a small set of upcoming candidate time slots.

    Returned slots are surfaced to the frontend as part of the interrupt
    payload so the picker UI shows times relative to "now", not stale
    hardcoded dates baked into the frontend.
    """
    # Pacific Time offset (PDT). Showcase only — a real app would use a
    # proper timezone library and the user's calendar availability.
    tz = timezone(timedelta(hours=-7))
    now = datetime.now(tz)
    tomorrow = (now + timedelta(days=1)).date()
    next_monday = (now + timedelta(days=(7 - now.weekday()) % 7 or 7)).date()

    def at(d, hour: int, minute: int = 0) -> datetime:
        return datetime(d.year, d.month, d.day, hour, minute, tzinfo=tz)

    candidates = [
        ("Tomorrow 10:00 AM", at(tomorrow, 10)),
        ("Tomorrow 2:00 PM", at(tomorrow, 14)),
        ("Monday 9:00 AM", at(next_monday, 9)),
        ("Monday 3:30 PM", at(next_monday, 15, 30)),
    ]
    return [{"label": label, "iso": dt.isoformat()} for label, dt in candidates]


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
    # `interrupt()` pauses the LangGraph run and forwards a structured
    # payload to the client. The frontend v2 `useInterrupt` hook renders
    # the picker inline in the chat, then calls `resolve(...)` with the
    # user's selection — that value comes back here as `response`.
    response: Any = interrupt(
        {
            "topic": topic,
            "attendee": attendee,
            "slots": _candidate_slots(),
        }
    )

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
