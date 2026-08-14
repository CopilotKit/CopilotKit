"""LangGraph agent backing the Shared State (Read-only) demo.

The UI owns a `recipe` object and writes it into agent state via
`agent.setState(...)`. This graph declares that key so LangGraph keeps
it, then injects the current recipe into the system prompt every turn.

There is no tool that mutates the recipe. The agent only reads it.
"""

from typing import Any, Awaitable, Callable, TypedDict

from langchain.agents import AgentState as BaseAgentState, create_agent
from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI

from copilotkit import CopilotKitMiddleware


class Ingredient(TypedDict, total=False):
    icon: str
    name: str
    amount: str


class Recipe(TypedDict, total=False):
    title: str
    skill_level: str
    cooking_time: str
    special_preferences: list[str]
    ingredients: list[Ingredient]
    instructions: list[str]


class AgentState(BaseAgentState):
    """Read-only shared state. The UI writes `recipe`; the agent reads it."""

    recipe: Recipe


class RecipeInjectorMiddleware(AgentMiddleware[AgentState, Any]):
    """Put the UI recipe into the model prompt on every turn."""

    state_schema = AgentState

    @property
    def name(self) -> str:
        return "RecipeInjectorMiddleware"

    def _build_recipe_message(self, recipe: Recipe) -> SystemMessage | None:
        if not recipe:
            return None
        lines = [
            "The user is editing this recipe in the app. Use it as the "
            "current recipe. Do not ask them to paste it.",
        ]
        if recipe.get("title"):
            lines.append(f"- Title: {recipe['title']}")
        if recipe.get("skill_level"):
            lines.append(f"- Skill level: {recipe['skill_level']}")
        if recipe.get("cooking_time"):
            lines.append(f"- Cooking time: {recipe['cooking_time']}")
        prefs = recipe.get("special_preferences") or []
        if prefs:
            lines.append(f"- Preferences: {', '.join(prefs)}")
        ingredients = recipe.get("ingredients") or []
        if ingredients:
            lines.append("- Ingredients:")
            for item in ingredients:
                name = item.get("name") or "ingredient"
                amount = item.get("amount")
                if amount:
                    lines.append(f"  - {name}: {amount}")
                else:
                    lines.append(f"  - {name}")
        instructions = recipe.get("instructions") or []
        if instructions:
            lines.append("- Instructions:")
            for step in instructions:
                lines.append(f"  - {step}")
        return SystemMessage(content="\n".join(lines))

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        recipe = request.state.get("recipe") or {}
        message = self._build_recipe_message(recipe)
        if message is None:
            return handler(request)
        return handler(request.override(messages=[message, *request.messages]))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        recipe = request.state.get("recipe") or {}
        message = self._build_recipe_message(recipe)
        if message is None:
            return await handler(request)
        return await handler(request.override(messages=[message, *request.messages]))


graph = create_agent(
    model=ChatOpenAI(model="gpt-5.5"),
    tools=[],
    middleware=[CopilotKitMiddleware(), RecipeInjectorMiddleware()],
    state_schema=AgentState,
    system_prompt=(
        "You are a helpful cooking assistant. "
        "The current recipe is supplied via shared state and is added as a "
        "system message at the start of every turn. "
        "Always answer from that recipe. Never ask the user to paste it. "
        "You cannot change the recipe card; you only read it."
    ),
)
