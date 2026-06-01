"""MS Agent Framework agent backing the In-Chat HITL (useHumanInTheLoop) demo.

The `book_call` tool is defined entirely on the frontend via
`useHumanInTheLoop`. CopilotKit's runtime forwards the frontend tool
definition to the agent at request time, so this agent has no backend tools
of its own -- it just needs to recognize "book a call" intent and emit the
tool call.

When the user picks a slot (or cancels), CopilotKit returns that choice as
the tool result and the agent confirms in a short follow-up message.
"""

from __future__ import annotations

from textwrap import dedent

from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent


SYSTEM_PROMPT = dedent(
    """
    You help users book an onboarding or intro call with the sales team.

    When the user asks to book a call, schedule a meeting, or set up a 1:1,
    call the frontend-provided `book_call` tool with:
    - `topic`: a short summary of what the call is about (e.g. 'Intro with
      sales', 'Q2 goals review').
    - `attendee`: who the call is with, if known (e.g. 'Alice from Sales').

    The tool surfaces a time-picker UI inside the chat. The user will pick a
    slot or cancel. After the tool returns, send one short confirmation
    sentence reflecting the user's choice (or noting cancellation). Do NOT
    ask for approval yourself -- always call the tool and let the picker
    handle the decision. Keep all replies to one sentence.
    """
).strip()


def create_hitl_in_chat_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the In-Chat HITL demo agent."""
    base_agent = Agent(
        client=chat_client,
        name="hitl_in_chat_agent",
        instructions=SYSTEM_PROMPT,
        # `book_call` is registered on the frontend via `useHumanInTheLoop`.
        tools=[],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMSAgentHitlInChatAgent",
        description=(
            "Scheduling assistant that delegates the time-picker interaction "
            "to a frontend-defined `book_call` tool rendered inline in the chat."
        ),
        require_confirmation=False,
    )
