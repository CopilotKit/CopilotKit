"""PydanticAI agent for the State Streaming cell.

The agent streams per-token changes to a shared document. The frontend
displays the document in an editor and diffs proposed changes.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Any

from ag_ui.core import EventType, StateSnapshotEvent
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel

load_dotenv()


class State(BaseModel):
    document: str = ""
    proposed_document: str = ""


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1-mini"),
    deps_type=StateDeps[State],
    system_prompt=dedent("""
        You are a helpful writing assistant. When the user asks you to
        edit the document, use set_proposed_document with the full
        revised text. The frontend will ask the user to confirm before
        applying.
    """).strip(),
)


@agent.tool
async def set_proposed_document(
    ctx: RunContext[StateDeps[State]],
    content: str,
) -> StateSnapshotEvent:
    """Propose a new full-document revision that the user can accept or reject."""
    ctx.deps.state.proposed_document = content
    return StateSnapshotEvent(
        type=EventType.STATE_SNAPSHOT,
        snapshot=ctx.deps.state,
    )
