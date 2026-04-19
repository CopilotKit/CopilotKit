"""LlamaIndex agent backing the Agentic Generative UI demo.

The agent exposes a write_plan backend tool that seeds agent state with
a list of steps; the frontend renders progress from agent.state.steps.
Progressive completion of steps is out of scope for this minimal cell;
the demo focuses on state-driven rendering rather than per-token progress.
"""

import asyncio
import json
from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


async def write_plan(
    steps: Annotated[
        list[dict],
        "List of step objects with description (string) and status ('pending' | 'completed')",
    ],
) -> str:
    """Write the plan into shared agent state for the UI to render."""
    return json.dumps({"steps": steps})


agent_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[],
    backend_tools=[write_plan],
    system_prompt=(
        "You are a planning assistant. When the user asks to plan something, "
        "call the write_plan tool with an array of {description, status} "
        'objects. Set status to "pending" for all steps.'
    ),
    initial_state={"steps": []},
)
