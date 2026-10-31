"""AG2 agent backing the In-Chat HITL (useHumanInTheLoop) demo.

The `book_call` tool is defined on the frontend via `useHumanInTheLoop`, so
there is no backend tool here: AG-UI forwards it to the agent as a client tool
and the time-picker render hook resolves it.
"""

from __future__ import annotations

from ag2 import Agent
from ag2.ag_ui import AGUIStream
from ag2.config.openai import OpenAIResponsesConfig
from fastapi import FastAPI

agent = Agent(
    "hitl_in_chat_assistant",
    prompt=(
        "You help users book an onboarding call with the sales team. "
        "When they ask to book or schedule a call, immediately call the "
        "frontend-provided `book_call` tool with a short topic and the "
        "attendee's name. Never ask clarifying questions first; pick sensible "
        "values from the request. Keep any chat reply to one short sentence."
    ),
    config=OpenAIResponsesConfig(model="gpt-5-mini", streaming=True),
)

stream = AGUIStream(agent)
hitl_in_chat_app = FastAPI(title="AG2 HITL in chat")
hitl_in_chat_app.mount("/", stream.build_asgi())
