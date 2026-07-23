"""PydanticAI agent backing the In-Chat HITL (useHumanInTheLoop) demo.

The `book_call` tool is defined on the FRONTEND via `useHumanInTheLoop`
(see ``src/app/demos/hitl-in-chat/page.tsx``), so there is no backend
tool here. The PydanticAI AG-UI bridge surfaces the frontend-registered
tool to the model on each run; the model calls it, the frontend renders
the time-picker card, and the user's selection flows back as a tool
result.

This mirrors the langgraph-python sibling — a chat-only agent with an
empty tools list and a short system prompt biasing toward calling the
frontend `book_call` tool when the user asks to book a call.
"""

from __future__ import annotations

from textwrap import dedent

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIResponsesModel


SYSTEM_PROMPT = dedent(
    """
    You help users book an onboarding call with the sales team.

    When the user asks to book a call, call the frontend-provided
    `book_call` tool with a short topic (what the call is about) and an
    attendee (who the call is with — e.g. "Alice from Sales"). The user
    will pick a time slot via the rendered card; respond with one short
    sentence acknowledging the booking once the tool returns.

    Keep all chat replies to one short sentence.
    """
).strip()


agent = Agent(
    model=OpenAIResponsesModel("gpt-4o-mini"),
    system_prompt=SYSTEM_PROMPT,
)


__all__ = ["agent"]
