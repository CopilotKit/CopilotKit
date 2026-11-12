"""The agent behind gen-ui-interrupt and interrupt-headless.

``schedule_meeting`` is marked ``needs_approval``, so the SDK pauses the run
before the tool executes and the adapter ends the AG-UI run with an interrupt
for the call, its arguments on ``metadata.tool_input``. The page renders the
time picker from them and resolves the interrupt with ``{"approved": true,
"chosen_time": ..., "chosen_label": ...}``, or ``{"approved": false}`` when
the user cancels. The next request carries that answer as a ``resume`` entry,
and the adapter runs an approved call before the model sees the conversation
again.

Nothing is kept on the server between the two runs: the paused call lives in
the conversation the page holds.
"""

from collections.abc import AsyncIterator
from contextlib import aclosing
from contextvars import ContextVar
from typing import Any

from ag_ui.core import BaseEvent, RunAgentInput
from ag_ui_openai_agents import OpenAIAgentsAgent
from agents import Agent, function_tool
from agents.tool_context import ToolContext

from demo_agents._common import MODEL, chat_settings

SYSTEM_PROMPT = """You are a scheduling assistant.

Whenever the user asks you to book a call or schedule a meeting, you MUST call
the `schedule_meeting` tool. Pass a short `topic` describing the purpose and, if
known, an `attendee` describing who the meeting is with.

The tool shows the user a time picker and returns their choice. Then briefly
confirm whether the meeting was scheduled and at what time, or note that the
user cancelled. Do not ask for approval yourself: always call the tool and let
the picker handle the decision. Keep responses short and friendly.

Never claim a meeting is scheduled unless the tool result says so."""

# This request's interrupt answers, by tool call id (see SchedulerAgent).
_answers: ContextVar[dict[str, dict[str, Any]]] = ContextVar("meeting_answers")


# @region[backend-interrupt-tool]
@function_tool(needs_approval=True)
def schedule_meeting(ctx: ToolContext[Any], topic: str, attendee: str = "") -> str:
    """Ask the user to pick a meeting time, then confirm what was scheduled.

    Args:
        topic: Short description of the meeting purpose.
        attendee: Who the meeting is with, if known.
    """
    # Runs once the user approved, with the time they picked beside it.
    answer = _answers.get({}).get(ctx.tool_call_id, {})
    label = answer.get("chosen_label") or answer.get("chosen_time")
    if not label:
        return f"User did not pick a time. Meeting NOT scheduled: {topic}"
    return f"Meeting scheduled for {label}: {topic}"


# @endregion[backend-interrupt-tool]


interrupt_agent = Agent(
    name="scheduler",
    instructions=SYSTEM_PROMPT,
    model=MODEL,
    model_settings=chat_settings(parallel_tool_calls=False),
    tools=[schedule_meeting],
)


# @region[interrupt-resume-payload]
class SchedulerAgent(OpenAIAgentsAgent):
    """Lets ``schedule_meeting`` read the time the user picked.

    The adapter runs an approved call with its arguments alone: an Agents SDK
    approval is a yes or a no, with nothing to hand the tool. The picker
    sends the time beside the approval, so this keeps each answer where the
    tool can read it.
    """

    async def run_streamed(self, input: RunAgentInput) -> AsyncIterator[BaseEvent]:
        _answers.set(
            {
                entry.interrupt_id: entry.payload
                for entry in input.resume or []
                if isinstance(entry.payload, dict)
            }
        )
        async with aclosing(super().run_streamed(input)) as events:
            async for event in events:
                yield event


# @endregion[interrupt-resume-payload]
