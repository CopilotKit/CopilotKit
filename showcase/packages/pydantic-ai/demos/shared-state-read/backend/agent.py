"""PydanticAI agent for the Shared State (Reading) cell.

The agent exposes a recipe state and tools to set/improve it. The
frontend reads the state and renders a recipe card.
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


class Ingredient(BaseModel):
    icon: str = "🍴"
    name: str = ""
    amount: str = ""


class Recipe(BaseModel):
    title: str = "Make Your Recipe"
    skill_level: str = "Intermediate"
    cooking_time: str = "45 min"
    special_preferences: list[str] = Field(default_factory=list)
    ingredients: list[Ingredient] = Field(default_factory=list)
    instructions: list[str] = Field(default_factory=list)


class State(BaseModel):
    recipe: Recipe = Field(default_factory=Recipe)


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1-mini"),
    deps_type=StateDeps[State],
    system_prompt=dedent("""
        You are a helpful recipe assistant. When the user asks for a
        recipe or improvements, use the update_recipe tool to replace
        the current recipe. Keep dietary preferences from the existing
        recipe when relevant.
    """).strip(),
)


@agent.tool
async def update_recipe(
    ctx: RunContext[StateDeps[State]],
    recipe: dict[str, Any],
) -> StateSnapshotEvent:
    """Replace the entire recipe with a new one."""
    ctx.deps.state.recipe = Recipe(**recipe)
    return StateSnapshotEvent(
        type=EventType.STATE_SNAPSHOT,
        snapshot=ctx.deps.state,
    )
