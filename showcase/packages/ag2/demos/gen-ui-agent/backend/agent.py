"""AG2 agent backing the Agentic Generative UI demo.

The agent plans a task as a series of steps and streams the plan
state back to the frontend. The frontend renders a live task-progress
card via useAgent's state hook.

AG2's state sync is coarse; we emit status-tagged plans by calling
the update_steps tool repeatedly.
"""

from __future__ import annotations

import asyncio
from typing import Annotated

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from dotenv import load_dotenv

load_dotenv()


async def update_steps(
    steps: Annotated[list[dict], "Full list of plan steps with status 'pending' or 'completed'"],
) -> dict:
    """Publish the current plan to the UI.

    Call repeatedly as work progresses — each call replaces the plan
    on the frontend. Status transitions: 'pending' -> 'completed'.
    """
    return {"steps": steps}


agent = ConversableAgent(
    name="assistant",
    system_message=(
        "You are an agentic planner. When the user asks for a plan, "
        "call update_steps with the full plan where every step has "
        "status='pending'. Then simulate progress by calling "
        "update_steps again with incrementally more steps flipped to "
        "status='completed', one step per call. Complete all steps "
        "before replying with a final summary."
    ),
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    functions=[update_steps],
)

stream = AGUIStream(agent)
