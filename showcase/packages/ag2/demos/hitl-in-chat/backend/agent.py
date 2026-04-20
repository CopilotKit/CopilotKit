"""AG2 agent backing the Human-in-the-Loop demo.

Provides a generate_task_steps tool. The actual approval gating happens
on the frontend via useHumanInTheLoop / useInterrupt, which pauses the
agent until the user confirms or rejects the proposed steps.
"""

from __future__ import annotations

from typing import Annotated

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from dotenv import load_dotenv

load_dotenv()


async def generate_task_steps(
    steps: Annotated[list[dict], "List of step objects: {description: str, status: 'enabled'|'disabled'|'executing'}"],
) -> dict:
    """Generate a list of task steps for the user to approve.

    The frontend renders an approval card via useHumanInTheLoop and
    waits for the user to confirm or reject. Returns the steps as-is;
    gating is enforced frontend-side.
    """
    return {"steps": steps, "status": "pending_approval"}


agent = ConversableAgent(
    name="assistant",
    system_message=(
        "You are a planning assistant. When the user asks for a plan "
        "(e.g. 'plan a trip', 'organize an event'), propose a list of "
        "steps by calling generate_task_steps with an array of "
        "{description, status:'enabled'} objects. Each step should be "
        "concrete and actionable. After the user confirms, continue "
        "with whatever they selected."
    ),
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    functions=[generate_task_steps],
)

stream = AGUIStream(agent)
