"""Agent backing the existing shared-state-read recipe demo.

The recipe demo is google-adk-specific and not a manifest feature — it
predates the langgraph-python `shared-state-read-write` pattern. The
agent reads `state["recipe"]` (UI-written) and writes back updated
recipes via `set_recipe`.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext


def set_recipe(tool_context: ToolContext, recipe: dict) -> dict:
    """Replace the entire recipe in shared state.

    Pass the FULL recipe object: title, skill_level, cooking_time,
    special_preferences, ingredients (list of {icon, name, amount}),
    instructions (list of strings).
    """
    tool_context.state["recipe"] = recipe
    return {"status": "ok"}


_INSTRUCTION = (
    "You are a recipe assistant. The current recipe lives in shared state "
    "under `recipe`; the user edits it in the UI and may also ask you to "
    "improve, simplify, or vary it. When the user wants the recipe "
    "changed, call set_recipe with the FULL updated recipe (every field). "
    "Keep titles short and ingredient counts realistic."
)

shared_state_read_agent = LlmAgent(
    name="SharedStateReadAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[set_recipe],
)
