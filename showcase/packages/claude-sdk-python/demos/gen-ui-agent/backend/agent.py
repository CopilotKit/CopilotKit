"""Claude Agent SDK (Python) backing the Agentic Generative UI demo.

The agent builds a plan of steps and progressively marks them complete, with
progress emitted as state snapshots. Frontend renders the TaskProgress card
from `agent.state.steps`.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Any

from ag_ui_runner import make_runner
from pydantic import BaseModel


TOOLS: list[dict[str, Any]] = [
    {
        "name": "set_plan",
        "description": (
            "Establish the full plan of steps for the task. Call exactly once at "
            "the start. Each step must have status='pending'."
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
                                "enum": ["pending", "completed"],
                            },
                        },
                        "required": ["description", "status"],
                    },
                }
            },
            "required": ["steps"],
        },
    },
    {
        "name": "complete_step",
        "description": (
            "Mark a single step (identified by its description) as completed. "
            "Call once per step, in order, after set_plan."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"description": {"type": "string"}},
            "required": ["description"],
        },
    },
]


SYSTEM_PROMPT = dedent(
    """
    You are a planning agent that runs a multi-step task live.

    Protocol:
      1. Call `set_plan` exactly once with the full list of steps (status='pending').
      2. For each step in order, call `complete_step` with that step's description.
      3. Finish with a brief summary when all steps are complete.

    Do not describe steps in prose before calling set_plan; the UI renders them.
    """
).strip()


class AgentState(BaseModel):
    steps: list[dict[str, Any]] = []


def execute_tool(name: str, tool_input: dict[str, Any], state: AgentState) -> tuple[str, AgentState | None]:
    if name == "set_plan":
        steps = tool_input.get("steps", [])
        new_state = state.model_copy()
        new_state.steps = [
            {"description": s.get("description", ""), "status": "pending"}
            for s in steps
        ]
        return f"Plan set with {len(new_state.steps)} steps.", new_state
    if name == "complete_step":
        desc = tool_input.get("description", "")
        new_state = state.model_copy()
        new_state.steps = [dict(s) for s in state.steps]
        for s in new_state.steps:
            if s.get("description") == desc and s.get("status") != "completed":
                s["status"] = "completed"
                break
        return f"Step completed: {desc}", new_state
    return f"Unknown tool: {name}", None


run_agent = make_runner(
    tools=TOOLS,
    system_prompt=SYSTEM_PROMPT,
    state_cls=AgentState,
    execute_tool=execute_tool,
)
