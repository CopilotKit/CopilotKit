"""
MS Agent Framework scheduling agent — interrupt-adapted.

This agent powers two demos (gen-ui-interrupt, interrupt-headless) that in the
LangGraph showcase rely on the native `interrupt()` primitive with
checkpoint/resume. The MS Agent Framework does NOT have that primitive, so we
adapt by delegating the time-picker interaction to a **frontend tool** that the
agent calls by name (`schedule_meeting`). The frontend registers the tool via
`useFrontendTool` with an async handler; that handler renders the interactive
picker, waits for the user to choose a slot (or cancel), and resolves the tool
call with the result. The backend only defines the system prompt and advertises
no local `schedule_meeting` implementation — the agent's tool call is satisfied
entirely by the frontend.

See `src/agents/agent.py` for the related `approval_mode="always_require"`
pattern used elsewhere in this package.
"""

from __future__ import annotations

from textwrap import dedent

from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent

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
    yourself — always call the tool and let the picker handle the decision.

    Keep responses short and friendly. After you finish executing tools,
    always send a brief final assistant message summarizing what happened so
    the message persists.
    """.strip()
)

def create_interrupt_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the scheduling-only agent used by the interrupt-adapted demos."""
    base_agent = Agent(
        client=chat_client,
        name="scheduling_agent",
        instructions=SYSTEM_PROMPT,
        # No backend tools. `schedule_meeting` is registered on the frontend
        # via `useFrontendTool` and dispatched through the CopilotKit runtime.
        tools=[],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkInterruptAgent",
        description=(
            "Scheduling assistant for the interrupt-adapted demos. Delegates "
            "the time-picker interaction to a frontend tool."
        ),
        require_confirmation=False,
    )
