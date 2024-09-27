"""Test Q&A Agent"""

from typing import cast
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.graph import MessagesState
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from copilotkit.langchain import (
  copilotkit_customize_config, copilotkit_exit, copilotkit_emit_message
)

class GreetAgentState(MessagesState):
    """Greet Agent State"""
    name: str

async def ask_name_node(state: GreetAgentState, config: RunnableConfig):
    """
    Ask the user for their name.
    """

    await copilotkit_emit_message(config, "Hey, what is your name? 🙂")

    return {
        "messages": state["messages"],
    }


async def extract_name_node(state: GreetAgentState, config: RunnableConfig):
    """
    Check if the user's name is in the message.
    """

    last_message = cast(HumanMessage, state["messages"][-1])


    system_message = (
        f"Figure out the user's name if possible from this response they gave you: {last_message.content}"
    )

    extract_name_tool = {
        'name': 'extract_name',
        'description': """Extract the user's name from the message.""",
        'parameters': {
            'type': 'object',
            'properties': {
                'name': {
                    'description': """The user's name or UNKNOWN if you can't find it""",
                    'type': 'string',                    
                }
            },
            'required': ['name']
        }
    }

    model = ChatOpenAI(model="gpt-4o").bind_tools(
        [extract_name_tool],
        parallel_tool_calls=False,
        tool_choice="extract_name"
    )

    response = await model.ainvoke([
        *state["messages"],
        SystemMessage(
            content=system_message
        )
    ], config)

    tool_calls = cast(AIMessage, response).tool_calls
    name = None

    if tool_calls is not None:
        if tool_calls[0]["args"]["name"] != "UNKNOWN":
            name = tool_calls[0]["args"]["name"]

    if name is None:
        return {
            "messages": state["messages"],
        }

    return {
        "messages": state["messages"],
        "name": name,
    }

async def greet_node(state: GreetAgentState, config: RunnableConfig):
    """
    Greet the user by name.
    """

    await copilotkit_emit_message(config, "Hello, " + state["name"] + " 😎")

    await copilotkit_exit(config)

    return {
        "messages": state["messages"],
    }

def route(state: GreetAgentState):
    """Route to the appropriate node."""

    if state.get("name", None) is not None:
        return "greet_node"
    return "ask_name_node"

workflow = StateGraph(GreetAgentState)

workflow.add_node("ask_name_node", ask_name_node)
workflow.add_node("greet_node", greet_node)
workflow.add_node("extract_name_node", extract_name_node)

workflow.set_entry_point("ask_name_node")

workflow.add_edge("ask_name_node", "extract_name_node")
workflow.add_conditional_edges("extract_name_node", route)
workflow.add_edge("greet_node", END)
memory = MemorySaver()
graph = workflow.compile(checkpointer=memory, interrupt_after=["ask_name_node"])
