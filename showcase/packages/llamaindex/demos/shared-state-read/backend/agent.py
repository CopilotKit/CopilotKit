"""LlamaIndex agent backing the Shared State (Reading) demo.

The agent calls a write_recipe tool to update shared state; the UI reads
agent.state.recipe and renders it as an editable recipe form.
"""

import json
from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


async def write_recipe(
    title: Annotated[str, "Recipe title"],
    skill_level: Annotated[str, "One of: Beginner, Intermediate, Advanced"],
    cooking_time: Annotated[
        str, "One of: 5 min, 15 min, 30 min, 45 min, 60+ min"
    ],
    special_preferences: Annotated[
        list[str],
        "Dietary preferences (High Protein, Low Carb, Spicy, Budget-Friendly, One-Pot Meal, Vegetarian, Vegan)",
    ],
    ingredients: Annotated[
        list[dict], "List of {icon, name, amount} ingredient objects"
    ],
    instructions: Annotated[list[str], "Ordered list of instruction strings"],
) -> str:
    """Write a recipe into shared agent state."""
    recipe = {
        "title": title,
        "skill_level": skill_level,
        "cooking_time": cooking_time,
        "special_preferences": special_preferences,
        "ingredients": ingredients,
        "instructions": instructions,
    }
    return json.dumps({"recipe": recipe})


agent_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[],
    backend_tools=[write_recipe],
    system_prompt=(
        "You are a recipe assistant. When asked to create or improve a recipe, "
        "call the write_recipe tool with all fields. Keep ingredient lists "
        "under 8 items and instructions concise."
    ),
    initial_state={
        "recipe": {
            "title": "Make Your Recipe",
            "skill_level": "Intermediate",
            "cooking_time": "45 min",
            "special_preferences": [],
            "ingredients": [
                {"icon": "carrot", "name": "Carrots", "amount": "3 large, grated"},
                {"icon": "wheat", "name": "All-Purpose Flour", "amount": "2 cups"},
            ],
            "instructions": ["Preheat oven to 350 F (175 C)"],
        }
    },
)
