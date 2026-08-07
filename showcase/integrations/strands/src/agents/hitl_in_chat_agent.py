"""Dedicated Strands agent for the In-Chat HITL (useHumanInTheLoop) demo.

The `book_call` tool is defined entirely on the frontend via
`useHumanInTheLoop`. CopilotKit's runtime forwards the frontend tool
definition to the agent at request time, so this agent has no backend tools
of its own — it just needs to recognize scheduling intent and emit the
tool call.

When the user picks a slot (or cancels), CopilotKit returns that choice as
the tool result and the agent confirms in a short follow-up message.

Mirrors MS Agent Python / LangGraph `hitl_in_chat_agent` system prompts so
the LGP-identical short frontend tool description still drives `book_call`.
"""

from __future__ import annotations

from textwrap import dedent

from strands import Agent
from ag_ui_strands import StrandsAgent

from agents.agent import _build_model

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
    ask for approval yourself — always call the tool and let the picker
    handle the decision. Keep all replies to one sentence.
    """
).strip()


def build_hitl_in_chat_agent() -> StrandsAgent:
    """Construct the In-Chat HITL StrandsAgent (frontend `book_call` only)."""
    strands_agent = Agent(
        model=_build_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=[],
    )

    return StrandsAgent(
        agent=strands_agent,
        name="hitl_in_chat",
        description=(
            "Scheduling assistant that delegates the time-picker interaction "
            "to a frontend-defined `book_call` tool rendered inline in the chat."
        ),
    )


__all__ = ["SYSTEM_PROMPT", "build_hitl_in_chat_agent"]
