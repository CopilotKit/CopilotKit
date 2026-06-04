"""LangGraph agent for the Human-in-the-Loop (Interrupt-based) booking demo.

Defines a backend tool `schedule_meeting(topic, attendee)` that uses
LangGraph's `interrupt()` primitive to pause the run and surface a
structured booking payload to the frontend. The frontend `useInterrupt`
renderer shows a time picker inline in the chat and resolves with
`{chosen_time, chosen_label}` or `{cancelled: true}`, which this tool
turns into a human-readable result the agent uses to confirm the booking.
"""

# @region[backend-interrupt-tool]
from __future__ import annotations

from datetime import datetime, time, timedelta
from typing import Any, List, Optional
from zoneinfo import ZoneInfo

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

# Demo-only fixed timezone. A real app would use the user's calendar +
# locale (e.g. zoneinfo.ZoneInfo(user.timezone) and Google Calendar /
# Outlook availability); we hardcode Pacific so screenshots are stable.
_DEMO_TZ = ZoneInfo("America/Los_Angeles")


def _candidate_slots() -> List[dict]:
    """Upcoming candidate slots, relative to "now" so the picker never
    shows stale dates."""
    now = datetime.now(_DEMO_TZ)
    tomorrow = (now + timedelta(days=1)).date()
    # Skip a week when the result would collide with `tomorrow` — i.e.
    # today is Mon (0 days away, picker would show two slots both
    # labelled "Monday") or Sun (1 day away, picker would show
    # "Tomorrow" and "Monday" both pointing at the same date).
    days_to_monday = (7 - now.weekday()) % 7
    if days_to_monday <= 1:
        days_to_monday += 7
    next_monday = (now + timedelta(days=days_to_monday)).date()
    candidates = [
        ("Tomorrow 10:00 AM", tomorrow, time(10, 0)),
        ("Tomorrow 2:00 PM", tomorrow, time(14, 0)),
        ("Monday 9:00 AM", next_monday, time(9, 0)),
        ("Monday 3:30 PM", next_monday, time(15, 30)),
    ]
    return [
        {"label": label, "iso": datetime.combine(d, t, _DEMO_TZ).isoformat()}
        for label, d, t in candidates
    ]


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


model = ChatOpenAI(model="gpt-5.4")

graph = create_agent(
    model=model,
    tools=[schedule_meeting],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
