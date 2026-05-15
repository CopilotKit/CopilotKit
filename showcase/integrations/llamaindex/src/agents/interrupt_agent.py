"""LlamaIndex scheduling agent -- interrupt-adapted.

This agent powers two demos (gen-ui-interrupt, interrupt-headless) that in the
LangGraph showcase rely on the native ``interrupt()`` primitive with
checkpoint/resume. LlamaIndex does NOT have that primitive, so we adapt by
delegating the time-picker interaction to a **frontend tool** that the agent
calls by name (``schedule_meeting``). The frontend registers the tool via
``useFrontendTool`` with an async handler; that handler renders the interactive
picker, waits for the user to choose a slot (or cancel), and resolves the tool
call with the result.

The backend provides a stub ``schedule_meeting`` tool so the LlamaIndex
AGUIChatWorkflow emits the proper AG-UI TOOL_CALL_CHUNK events. Actual
execution happens on the frontend; the stub is never invoked because
CopilotKit intercepts the tool call before the backend can process the result.

See ``src/agents/hitl_in_chat_agent.py`` for the related ``book_call`` pattern
used by the HITL-in-chat demos in this package.
"""

from __future__ import annotations

import os

from llama_index.core.tools import FunctionTool
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

from agents.hitl_in_chat_agent import FixedAGUIChatWorkflow

_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


# @region[backend-tool-call]
SYSTEM_PROMPT = (
    "You are a scheduling assistant. Whenever the user asks you to book a call "
    "or schedule a meeting, you MUST call the `schedule_meeting` tool. Pass a "
    "short `topic` describing the purpose of the meeting and, if known, an "
    "`attendee` describing who the meeting is with.\n\n"
    "The `schedule_meeting` tool is implemented on the client: it surfaces a "
    "time-picker UI to the user and returns the user's selection. After the "
    "tool returns, briefly confirm whether the meeting was scheduled and at "
    "what time, or note that the user cancelled. Do NOT ask for approval "
    "yourself -- always call the tool and let the picker handle the decision.\n\n"
    "Keep responses short and friendly. After you finish executing tools, "
    "always send a brief final assistant message summarizing what happened so "
    "the message persists."
)


def _schedule_meeting_stub(topic: str, attendee: str = "") -> str:
    """Ask the user to pick a time slot for a meeting.

    The picker UI presents fixed candidate slots; the user's choice is
    returned to the agent.
    """
    # Frontend-only tool -- CopilotKit intercepts the call and renders the
    # TimePickerCard. This stub satisfies the AGUIChatWorkflow tool registry
    # so the proper AG-UI events are emitted.
    return ""


_schedule_meeting_tool = FunctionTool.from_defaults(
    fn=_schedule_meeting_stub,
    name="schedule_meeting",
    description=(
        "Ask the user to pick a time slot for a meeting. Pass a short "
        "`topic` and optional `attendee`. The picker UI presents fixed "
        "candidate slots; the user's choice is returned to the agent."
    ),
)


async def _workflow_factory():
    return FixedAGUIChatWorkflow(
        llm=OpenAI(model="gpt-4o-mini", **_openai_kwargs),
        frontend_tools=[_schedule_meeting_tool],
        backend_tools=[],
        system_prompt=SYSTEM_PROMPT,
        initial_state={},
    )


interrupt_router = get_ag_ui_workflow_router(
    workflow_factory=_workflow_factory,
)
# @endregion[backend-tool-call]
