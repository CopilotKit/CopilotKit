"""PydanticAI scheduling agent -- interrupt-adapted.

This agent powers two demos (gen-ui-interrupt, interrupt-headless) that in the
LangGraph showcase rely on the native ``interrupt()`` primitive with
checkpoint/resume. PydanticAI does NOT have that primitive, so we adapt by
delegating the time-picker interaction to a **frontend tool** that the agent
calls by name (``schedule_meeting``). The frontend registers the tool via
``useFrontendTool`` with an async handler; that handler renders the interactive
picker, waits for the user to choose a slot (or cancel), and resolves the tool
call with the result. The backend only defines the system prompt and advertises
no local ``schedule_meeting`` implementation -- the agent's tool call is
satisfied entirely by the frontend.

See ``src/agents/hitl_in_chat_agent.py`` for the related ``book_call`` pattern
used by the HITL-in-chat demos in this package.
"""

from __future__ import annotations

from textwrap import dedent

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIResponsesModel


# @region[backend-tool-call]
SYSTEM_PROMPT = dedent(
    """
    You are a scheduling assistant. Whenever the user asks you to book a call
    or schedule a meeting, you MUST call the `schedule_meeting` tool. Pass a
    short `topic` describing the purpose of the meeting and, if known, an
    `attendee` describing who the meeting is with.

    The `schedule_meeting` tool is implemented on the client: it surfaces a
    time-picker UI to the user and returns the user's selection. After the
    tool returns, briefly confirm whether the meeting was scheduled and at
    what time, or note that the user cancelled. Do NOT ask for approval
    yourself -- always call the tool and let the picker handle the decision.

    Keep responses short and friendly. After you finish executing tools,
    always send a brief final assistant message summarizing what happened so
    the message persists.
    """.strip()
)


agent = Agent(
    model=OpenAIResponsesModel("gpt-4o-mini"),
    system_prompt=SYSTEM_PROMPT,
)
# @endregion[backend-tool-call]


__all__ = ["agent"]
