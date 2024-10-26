"""Test Q&A Agent"""

import os
from typing import cast
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langgraph.graph import StateGraph, END
from langgraph.graph import MessagesState
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import HumanMessage, AIMessage
from copilotkit.langchain import (
    copilotkit_exit,
    copilotkit_emit_message
)
from pydantic import BaseModel, Field
from my_agent.state import GreetAgentState
from my_agent.model import get_model

class ExtractNameTool(BaseModel):
    """
    Extract the user's name from the message.
    Make sure to only set the name if you are 100 percent sure it is the name of the user.
    """
    name: str = Field(..., description="The user's name or UNKNOWN if you can't find it")

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


    instructions = (
        f"Figure out the user's name if possible from this response they gave you: {last_message.content}"
    )

    model = get_model(state).bind_tools(
        [ExtractNameTool],
        tool_choice="ExtractNameTool"
    )

    response = await model.ainvoke([
        *state["messages"],
        HumanMessage(
            content=instructions
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
