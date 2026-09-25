"""Native CrewAI async HITL Flow for inline and headless interrupts."""

from __future__ import annotations

import json
from datetime import datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from crewai.flow import Flow, HumanFeedbackResult, human_feedback, listen, start
from litellm import acompletion
from pydantic import Field

from ag_ui_crewai import (
    CopilotKitState,
    agui_feedback_provider,
    copilotkit_emit_tool_result,
    copilotkit_stream,
)


SYSTEM_PROMPT = (
    "You are a scheduling assistant. Whenever the user asks to book a call or "
    "schedule a meeting, call schedule_meeting with a short topic and optional "
    "attendee. After the tool result, briefly confirm the selected time or "
    "that the user cancelled."
)
DEMO_TZ = ZoneInfo("America/Los_Angeles")

SCHEDULE_MEETING_TOOL = {
    "type": "function",
    "function": {
        "name": "schedule_meeting",
        "description": "Ask the user to choose a meeting time.",
        "parameters": {
            "type": "object",
            "properties": {
                "topic": {"type": "string"},
                "attendee": {"type": "string"},
            },
            "required": ["topic"],
        },
    },
}


def candidate_slots() -> list[dict[str, str]]:
    """Return stable labels attached to future Pacific timestamps."""
    now = datetime.now(DEMO_TZ)
    tomorrow = (now + timedelta(days=1)).date()
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
        {"label": label, "iso": datetime.combine(day, at, DEMO_TZ).isoformat()}
        for label, day, at in candidates
    ]


class InterruptState(CopilotKitState):
    pending_tool_call_id: str | None = None
    meeting: dict[str, Any] = Field(default_factory=dict)


class InterruptFlow(Flow[InterruptState]):
    """Pause after schedule_meeting and continue from a spec resume entry."""

    @start()
    @human_feedback(
        message="Choose a meeting time or cancel the request.",
        llm=None,
        provider=agui_feedback_provider,
    )
    async def request_schedule(self) -> dict[str, Any]:
        response = await copilotkit_stream(
            await acompletion(
                model="openai/gpt-5.4",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *self.state.messages,
                ],
                tools=[SCHEDULE_MEETING_TOOL],
                tool_choice={
                    "type": "function",
                    "function": {"name": "schedule_meeting"},
                },
                parallel_tool_calls=False,
                stream=True,
            )
        )
        message = response.choices[0].message
        self.state.messages.append(message)
        tool_calls = message.get("tool_calls") or []
        schedule_call = next(
            (
                call
                for call in tool_calls
                if call.get("function", {}).get("name") == "schedule_meeting"
            ),
            None,
        )
        if schedule_call is None:
            return {
                "topic": "Meeting",
                "attendee": None,
                "slots": candidate_slots(),
            }

        try:
            arguments = json.loads(
                schedule_call.get("function", {}).get("arguments") or "{}"
            )
        except (TypeError, json.JSONDecodeError):
            arguments = {}
        self.state.pending_tool_call_id = schedule_call.get("id")
        slots = arguments.get("slots")
        return {
            "topic": arguments.get("topic") or "Meeting",
            "attendee": arguments.get("attendee"),
            "slots": slots if isinstance(slots, list) and slots else candidate_slots(),
        }

    @listen("request_schedule")
    async def confirm_schedule(self, result: HumanFeedbackResult) -> None:
        feedback_text = result.feedback or ""
        try:
            feedback = json.loads(feedback_text or "{}")
        except (TypeError, json.JSONDecodeError):
            feedback = {}
        if not isinstance(feedback, dict):
            feedback = {}
        output = result.output if isinstance(result.output, dict) else {}
        # The AG-UI CrewAI provider resumes a cancelled protocol interrupt
        # with an empty feedback string. Submitted choices are JSON objects,
        # so an empty payload is the package's authoritative cancel signal.
        cancelled = not feedback_text.strip() or bool(feedback.get("cancelled"))
        self.state.meeting = {
            "topic": output.get("topic") or "Meeting",
            "attendee": output.get("attendee"),
            "time": None if cancelled else feedback.get("chosen_time"),
            "label": None if cancelled else feedback.get("chosen_label"),
            "cancelled": cancelled,
        }

        if self.state.pending_tool_call_id:
            result_content = json.dumps(self.state.meeting)
            self.state.messages.append(
                {
                    "role": "tool",
                    "tool_call_id": self.state.pending_tool_call_id,
                    "content": result_content,
                }
            )
            await copilotkit_emit_tool_result(
                self.state.pending_tool_call_id, result_content
            )
        response = await copilotkit_stream(
            await acompletion(
                model="openai/gpt-5.4",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            f"{SYSTEM_PROMPT}\nScheduling outcome: "
                            f"{json.dumps(self.state.meeting)}"
                        ),
                    },
                    *self.state.messages,
                ],
                tools=[SCHEDULE_MEETING_TOOL],
                parallel_tool_calls=False,
                stream=True,
            )
        )
        self.state.messages.append(response.choices[0].message)


interrupt_flow = InterruptFlow()
