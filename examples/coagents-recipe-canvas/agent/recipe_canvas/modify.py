"""
The modify node is responsible for modifying the recipes in the state.
"""

from recipe_canvas.state import AgentState
from langchain_core.runnables import RunnableConfig
from typing import cast
from langchain_core.messages import AIMessage, ToolMessage, SystemMessage
from copilotkit.langchain import copilotkit_emit_state, copilotkit_customize_config

async def modify_node(state: AgentState, config: RunnableConfig): # pylint: disable=unused-argument
    """
    The modify node is responsible for modifying the recipes in the state.
    """
    ai_message = cast(AIMessage, state["messages"][-1])

    state["recipes"] = state.get("recipes", [])
    state["logs"] = state.get("logs", [])
    queries = ai_message.tool_calls[0]["args"]["queries"]

    for query in queries:
        state["logs"].append({
            "message": f"Modify recipe for {query}",
            "done": False
        })

    await copilotkit_emit_state(config, state)

    modify_results = []

    for i, query in enumerate(queries):
        response = modify_recipe(query)
        modify_results.append(response)
        state["logs"][i]["done"] = True
        await copilotkit_emit_state(config, state)

    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[{
            "state_key": "recipes",
            "tool": "ModifyRecipes",
            "tool_argument": "recipes",
        }],
    )

    model = get_model(state)
    ainvoke_kwargs = {}
    if model.__class__.__name__ in ["ChatOpenAI"]:
        ainvoke_kwargs["parallel_tool_calls"] = False

    # figure out which recipes to use
    response = await model.bind_tools(
        [ModifyRecipes],
        tool_choice="ModifyRecipes",
        **ainvoke_kwargs
    ).ainvoke([
        SystemMessage(
            content="""
            You need to modify the 3-5 most relevant recipes from the following search results.
            """
        ),
        *state["messages"],
        ToolMessage(
            tool_call_id=ai_message.tool_calls[0]["id"],
            content=f"Performed modification: {modify_results}"
        )
    ], config)

    state["logs"] = []
    await copilotkit_emit_state(config, state)

    ai_message_response = cast(AIMessage, response)
    recipes = ai_message_response.tool_calls[0]["args"]["recipes"]

    state["recipes"].extend(recipes)

    state["messages"].append(ToolMessage(
        tool_call_id=ai_message.tool_calls[0]["id"],
        content=f"Modified the following recipes: {recipes}"
    ))

    return state