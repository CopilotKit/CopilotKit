"""Claude Agent SDK (Python) backing the In-Chat Human-in-the-Loop demo.

The agent plans a multi-step task and surfaces the plan as a
``generate_task_steps`` tool call. The frontend renders a review/approve UI
(via useHumanInTheLoop) and responds; backend simply acknowledges.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Any

from ag_ui_runner import make_runner
from pydantic import BaseModel


TOOLS: list[dict[str, Any]] = [
    {
        "name": "generate_task_steps",
        "description": (
            "Propose a list of steps for the user to review and approve. "
            "Always call this tool when the user asks you to plan something."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "status": {
                                "type": "string",
                                "enum": ["enabled", "disabled", "executing"],
                            },
                        },
                        "required": ["description", "status"],
                    },
                    "description": "Ordered list of steps for the user to review.",
                }
            },
            "required": ["steps"],
        },
    },
]


SYSTEM_PROMPT = dedent(
    """
    You are a helpful planning assistant.

    When the user asks you to plan something (a trip, a recipe, a project, etc.),
    call `generate_task_steps` with a list of steps, each status set to "enabled".
    After the user reviews and responds, summarize which steps they approved.

    Keep responses concise.
    """
).strip()


class AgentState(BaseModel):
    pass


def execute_tool(name: str, tool_input: dict[str, Any], state: AgentState) -> tuple[str, AgentState | None]:
    if name == "generate_task_steps":
        steps = tool_input.get("steps", [])
        return f"Presented {len(steps)} steps for review.", None
    return f"Unknown tool: {name}", None


run_agent = make_runner(
    tools=TOOLS,
    system_prompt=SYSTEM_PROMPT,
    state_cls=AgentState,
    execute_tool=execute_tool,
)
