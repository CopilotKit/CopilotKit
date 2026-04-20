"""PydanticAI agent for the Human-in-the-Loop cell.

The agent can propose scheduled meetings. The actual approval gate lives
on the frontend via useHumanInTheLoop — the tool just returns a pending
status.
"""

from __future__ import annotations

import json
from textwrap import dedent
from typing import Any

from dotenv import load_dotenv
from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel

load_dotenv()


class State(BaseModel):
    """Placeholder state for the HITL cell."""


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1-mini"),
    deps_type=StateDeps[State],
    system_prompt=dedent("""
        You are a helpful assistant. When the user asks to plan something,
        use generate_task_steps to propose a list of steps they can review.
        When the user asks to schedule a meeting, call schedule_meeting.
    """).strip(),
)


@agent.tool
def schedule_meeting(
    ctx: RunContext[StateDeps[State]],
    reason: str,
    duration_minutes: int = 30,
) -> str:
    """Schedule a meeting. The user will be asked to pick a time via the UI."""
    return json.dumps({
        "status": "pending_approval",
        "reason": reason,
        "duration_minutes": duration_minutes,
        "message": (
            f"Meeting request: {reason} ({duration_minutes} min). "
            "Awaiting human approval."
        ),
    })
