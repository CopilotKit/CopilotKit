"""LangGraph agent backing the Shared State (Reading) demo.

Demonstrates reading agent state from the UI: the agent owns a typed
`recipe` field in its state, and the frontend reflects changes to that
state in real time via useAgent().

The agent exposes a single tool (`update_recipe`) that mutates the
`recipe` slot in agent state. When the user asks "make it Italian" or
"add more vegetables", the LLM calls `update_recipe`, the new recipe is
persisted to agent state, and the UI's card re-renders from the new
state. This is the canonical LangGraph-Python shared-state pattern
documented at docs.copilotkit.ai/integrations/langgraph/shared-state.
"""

from typing import Literal, TypedDict

from langchain.agents import AgentState as BaseAgentState, create_agent
from langchain.tools import ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.types import Command

from copilotkit import CopilotKitMiddleware


class Ingredient(TypedDict):
    icon: str
    name: str
    amount: str


class Recipe(TypedDict, total=False):
    title: str
    skill_level: Literal["Beginner", "Intermediate", "Advanced"]
    cooking_time: Literal["5 min", "15 min", "30 min", "45 min", "60+ min"]
    special_preferences: list[str]
    ingredients: list[Ingredient]
    instructions: list[str]


class AgentState(BaseAgentState):
    """Shared state: the UI mirrors `recipe` via useAgent()."""

    recipe: Recipe


@tool
def update_recipe(recipe: Recipe, runtime: ToolRuntime) -> Command:
    """Update the full recipe in shared agent state.

    Call this whenever the user asks to modify the recipe (title,
    ingredients, instructions, skill level, cooking time, dietary
    preferences). Always return the *full* recipe — not a partial diff.
    """
    return Command(
        update={
            "recipe": recipe,
            "messages": [
                ToolMessage(
                    content="Recipe updated.",
                    tool_call_id=runtime.tool_call_id,
                )
            ],
        }
    )


graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[update_recipe],
    middleware=[CopilotKitMiddleware()],
    state_schema=AgentState,
    system_prompt=(
        "You are a cooking assistant that collaborates on a single recipe "
        "that is kept in shared agent state. "
        "The current recipe is available in state under the `recipe` key. "
        "When the user asks to change the recipe (e.g. 'make it Italian', "
        "'add more vegetables', 'make it vegan'), call the `update_recipe` "
        "tool with the FULL updated recipe. Preserve fields you are not "
        "changing. Keep reply messages short — the UI is the primary "
        "rendering surface."
    ),
)
