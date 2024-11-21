"""Chat Node"""

from typing import List, cast
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import SystemMessage, AIMessage, ToolMessage
from langchain.tools import tool
from copilotkit.langchain import copilotkit_customize_config
from recipe_canvas.state import AgentState
from recipe_canvas.model import get_model
from recipe_canvas.download import get_resource

@tool
def SearchRecipes(queries: List[str]): # pylint: disable=invalid-name,unused-argument
    """A list of one or more search queries to find good recipes."""

@tool
def ModifyRecipe(recipe: str): # pylint: disable=invalid-name,unused-argument
    """Modify the recipe."""

@tool
def DeleteRecipes(urls: List[str]): # pylint: disable=invalid-name,unused-argument
    """Delete the URLs from the recipes."""


async def chat_node(state: AgentState, config: RunnableConfig):
    """
    Chat Node
    """

    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[{
            "state_key": "recipe",
            "tool": "ModifyRecipe",
            "tool_argument": "recipe",
        }],
        emit_tool_calls="DeleteRecipes"
    )

    state["recipes"] = state.get("recipes", [])
    recipe = state.get("recipe", "")

    recipes = []

    for recipe in state["recipes"]:
        content = get_resource(recipe["url"])
        if content == "ERROR":
            continue
        recipes.append({
            **recipe,
            "content": content
        })

    model = get_model(state)
    # Prepare the kwargs for the ainvoke method
    ainvoke_kwargs = {}
    if model.__class__.__name__ in ["ChatOpenAI"]:
        ainvoke_kwargs["parallel_tool_calls"] = False

    response = await model.bind_tools(
        [
            SearchRecipes,
            ModifyRecipe,
            DeleteRecipes,
        ],
        **ainvoke_kwargs  # Pass the kwargs conditionally
    ).ainvoke([
        SystemMessage(
            content=f"""
            You are a recipe assistant. You help the user with modifying a recipe.
            Do not recite the recipes, instead use them to answer the user's question.
            You should use the search tool to get recipes before answering the user's question.
            If you finished modifying the recipe, ask the user proactively for next steps, changes etc, make it engaging.
            To modify the recipe, you should use the ModifyRecipe tool. Never EVER respond with the recipe, only use the tool.

            This is the recipe:
            {recipe}

            Here are the recipes that you have available:
            {recipes}
            """
        ),
        *state["messages"],
    ], config)

    ai_message = cast(AIMessage, response)

    if ai_message.tool_calls:
        if ai_message.tool_calls[0]["name"] == "ModifyRecipe":
            recipe = ai_message.tool_calls[0]["args"].get("recipe", "")
            return {
                "recipe": recipe,
                "messages": [ai_message, ToolMessage(
                    tool_call_id=ai_message.tool_calls[0]["id"],
                    content="Recipe modified."
                )]
            }

    return {
        "messages": response
    }
