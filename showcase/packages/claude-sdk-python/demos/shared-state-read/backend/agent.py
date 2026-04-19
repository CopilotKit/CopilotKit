"""Claude Agent SDK (Python) backing the Shared State (Reading) demo.

Agent and UI share a recipe object. The UI writes directly; the agent reads
the current recipe via system prompt and proposes updates with `update_recipe`.
"""

from __future__ import annotations

import json
from textwrap import dedent
from typing import Any

from ag_ui_runner import make_runner
from pydantic import BaseModel


TOOLS: list[dict[str, Any]] = [
    {
        "name": "update_recipe",
        "description": (
            "Update the shared recipe object. Provide only the fields that change; "
            "unspecified fields are left alone."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "skill_level": {
                    "type": "string",
                    "enum": ["Beginner", "Intermediate", "Advanced"],
                },
                "cooking_time": {
                    "type": "string",
                    "enum": ["5 min", "15 min", "30 min", "45 min", "60+ min"],
                },
                "special_preferences": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "ingredients": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "icon": {"type": "string"},
                            "name": {"type": "string"},
                            "amount": {"type": "string"},
                        },
                        "required": ["name", "amount"],
                    },
                },
                "instructions": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
        },
    },
]


SYSTEM_PROMPT = dedent(
    """
    You are a friendly cooking assistant. You help the user design recipes.

    Whenever you change any aspect of the recipe, call `update_recipe` with the
    new field values. Read the current recipe from the context provided below.

    Keep your text responses short -- the recipe card in the UI shows the
    recipe itself.
    """
).strip()


class AgentState(BaseModel):
    recipe: dict[str, Any] = {}


def execute_tool(name: str, tool_input: dict[str, Any], state: AgentState) -> tuple[str, AgentState | None]:
    if name == "update_recipe":
        new_recipe = dict(state.recipe)
        for key, value in tool_input.items():
            if value is not None:
                new_recipe[key] = value
        new_state = state.model_copy()
        new_state.recipe = new_recipe
        return json.dumps({"status": "updated", "recipe": new_recipe}), new_state
    return f"Unknown tool: {name}", None


def system_prompt_for_state(base: str, state: AgentState) -> str:
    if not state.recipe:
        return base
    return f"{base}\n\nCurrent recipe:\n{json.dumps(state.recipe, indent=2)}"


run_agent = make_runner(
    tools=TOOLS,
    system_prompt=SYSTEM_PROMPT,
    state_cls=AgentState,
    execute_tool=execute_tool,
    system_prompt_for_state=system_prompt_for_state,
)
