"""LlamaIndex agent backing the Human-in-the-Loop demo.

The agent proposes a list of task steps via the generate_task_steps
frontend tool; the UI renders an approval surface before execution.
"""

from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


def generate_task_steps(
    steps: Annotated[
        list[dict],
        "Array of step objects with 'description' (string) and 'status' ('enabled' or 'disabled')",
    ],
) -> str:
    """Generate a list of task steps for the user to review and approve."""
    return f"Generated {len(steps)} steps for review"


agent_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[generate_task_steps],
    backend_tools=[],
    system_prompt=(
        "You are a concise planning assistant. When the user asks for a plan, "
        "call the generate_task_steps tool with a list of steps. Each step is "
        'an object {description, status}; set status to "enabled" by default.'
    ),
)
