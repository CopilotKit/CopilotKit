"""Test Joker Agent"""

from typing import Any, cast

from langchain_anthropic import ChatAnthropic
from langgraph.graph import StateGraph, END
from langgraph.graph import MessagesState
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import SystemMessage, ToolMessage


from copilotkit.langchain import copilotkit_customize_config, copilotkit_exit

class JokeAgentState(MessagesState):
    """Joke Agent State"""
    joke: str

async def joke_node(state: JokeAgentState, config: RunnableConfig):
    """
    Make a joke.
    """

    config = copilotkit_customize_config(
        config,
        emit_messages=True,
        emit_intermediate_state=[
            {
                "state_key": "joke",
                "tool": "make_joke",
                "tool_argument": "the_joke"
            },
        ]
    )

    system_message = "You make funny jokes."

    joke_tool = {
        'name': 'make_joke',
        'description': """Make a funny joke.""",
        'parameters': {
            'type': 'object',
            'properties': {
                'the_joke': {
                    'description': """The joke""",
                    'type': 'string',                    
                }
            },
            'required': ['the_joke']
        }
    }

    joke_model = ChatAnthropic(
        model_name="claude-3-5-sonnet-20240620",
        timeout=None,
        stop=None
    ).bind_tools(
        [joke_tool],
        tool_choice="make_joke"
    )

    response = await joke_model.ainvoke([
         SystemMessage(
            content=system_message
        ),
        *state["messages"]
    ], config)

    tool_calls = getattr(response, "tool_calls")

    joke = tool_calls[0]["args"]["the_joke"]

    await copilotkit_exit(config)

    return {
        "messages": [
            response,
            ToolMessage(
                name=tool_calls[0]["name"],
                content=joke,
                tool_call_id=tool_calls[0]["id"]
            )
        ],
        "joke": joke,
    }

workflow = StateGraph(JokeAgentState)
workflow.add_node("joke_node", cast(Any, joke_node))
workflow.set_entry_point("joke_node")

workflow.add_edge("joke_node", END)
memory = MemorySaver()
joke_graph = workflow.compile(checkpointer=memory)
