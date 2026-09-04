"""Dedicated Strands agent for the two interrupt demos.

`schedule_meeting` pauses itself through Strands' native interrupt system:
`tool_context.interrupt(...)` halts the agent loop and the AG-UI bridge finishes
the run with `RUN_FINISHED` carrying `outcome.type == "interrupt"`. The frontend
renders the time picker from the interrupt payload and resuming on the same
`thread_id` returns the user's choice to that same `interrupt()` call, so the
tool body continues where it left off.

The resume payload arrives wrapped: a resolved answer as `{"response": ...}`, a
client-side cancel as `{"cancelled": True}`. The bridge wraps it because
Strands' resume gate is truthiness-based, and a bare falsy answer would re-raise
the same interrupt forever.

This is a dedicated agent rather than a tool on the shared showcase agent
because `hitl-in-chat` registers a FRONTEND tool of the same name; one backend
`schedule_meeting` cannot be both a client-executed tool and a pausing backend
tool.

Pause and resume happen in the same process here, so no `SessionManager` is
needed. Durable resume across a restart requires one.

Docs: https://strandsagents.com/docs/user-guide/concepts/interrupts/
"""

from __future__ import annotations

from collections.abc import Mapping

from strands import Agent, tool
from strands.types.tools import ToolContext
from ag_ui_strands import StrandsAgent

from agents.agent import _build_model

SYSTEM_PROMPT = """You are a scheduling assistant.

Whenever the user asks you to book a call or schedule a meeting, you MUST call
the `schedule_meeting` tool. Pass a short `topic` describing the purpose and, if
known, an `attendee` describing who the meeting is with.

The tool pauses execution and shows the user a time picker. Once it resumes with
their choice, briefly confirm whether the meeting was scheduled and at what
time, or note that the user cancelled. Do not ask for approval yourself: always
call the tool and let the picker handle the decision. Keep responses short and
friendly.

Never claim a meeting is scheduled unless the tool result says so."""


# @region[backend-interrupt-tool]
@tool(context=True)
def schedule_meeting(topic: str, tool_context: ToolContext, attendee: str = "") -> str:
    """Ask the user to pick a meeting time, then confirm what was scheduled.

    Args:
        topic: Short description of the meeting purpose.
        attendee: Who the meeting is with, if known.
    """
    answer = tool_context.interrupt(
        "schedule_meeting",
        reason={"topic": topic, "attendee": attendee},
    )

    # Two cancel shapes reach here: the bridge's sentinel for a cancelled resume
    # entry, and the picker's own Cancel button, which resolves with a
    # `cancelled` flag inside the payload. The envelope is the bridge's, but the
    # value inside it is whatever the client sent, so it is checked rather than
    # assumed.
    inner = answer.get("response")
    payload = inner if isinstance(inner, Mapping) else {}
    if answer.get("cancelled") or payload.get("cancelled"):
        return f"User cancelled. Meeting NOT scheduled: {topic}"

    label = payload.get("chosen_label") or payload.get("chosen_time")
    if not label:
        return f"User did not pick a time. Meeting NOT scheduled: {topic}"
    return f"Meeting scheduled for {label}: {topic}"
# @endregion[backend-interrupt-tool]


def build_interrupt_agent() -> StrandsAgent:
    """Construct the StrandsAgent backing gen-ui-interrupt and interrupt-headless."""
    strands_agent = Agent(
        model=_build_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=[schedule_meeting],
    )
    return StrandsAgent(
        agent=strands_agent,
        name="interrupt",
        description=(
            "Strands agent whose scheduling tool pauses natively for the user "
            "to pick a time"
        ),
    )
