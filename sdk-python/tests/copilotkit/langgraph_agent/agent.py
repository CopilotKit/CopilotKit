"""
A LangGraph implementation of the human-in-the-loop agent.
"""

import json
from typing import Dict, List, Any

# LangGraph imports
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END, START
from langgraph.types import Command, interrupt
from langgraph.checkpoint.memory import MemorySaver

# CopilotKit imports
from copilotkit import CopilotKitState
from copilotkit.langgraph import copilotkit_customize_config

# LLM imports
from langchain_core.messages import SystemMessage
from copilotkit.langgraph import (copilotkit_exit)

# Constants
HUMAN_FEEDBACK_AFTER_INTERRUPT = "Here is my feedback"
INTERRUPTED_NODE_NAME = "interrupted_node"

class AgentState(CopilotKitState):
    """
    The state of the agent.
    It inherits from CopilotKitState which provides the basic fields needed by CopilotKit.
    """

async def start_flow(state: Dict[str, Any], config: RunnableConfig):
    """
    This is the entry point for the flow.
    """
    updated_state = dict(state)
    updated_state["messages"] = [
        SystemMessage(content="You are a helpful assistant."),
        AIMessage(content="Hello, how are you?")
    ]
    return Command(
        goto="chat_node",
        update={
            "messages": updated_state["messages"],
        }
    )


async def chat_node(state: Dict[str, Any], config: RunnableConfig):
    response = ToolMessage(
        content="Hello",
        tool_call_id="123",
        name="fake_tool"
    )

    print(response)

    # Update messages with the response
    messages = state["messages"] + [response]
    
    await copilotkit_exit(config)
    return Command(
        goto="interrupted_node",
        update={
            "messages": messages,
        }
    )


async def interrupted_node(state: Dict[str, Any], config: RunnableConfig):
    """
    This node handles the user interrupt for step customization and generates the final response.
    """

    # Check if we already have a user_response in the state
    # This happens when the node restarts after an interrupt
    if "user_response" in state and state["user_response"]:
        user_response = state["user_response"]
    else:
        # Use LangGraph interrupt to get user input on steps
        # This will pause execution and wait for user input in the frontend
        user_response = interrupt({
            "tell": "me what you think",
        })
        # Store the user response in state for when the node restarts
        state["user_response"] = user_response
    
    # Add the final response to messages
    messages = state["messages"] + [user_response]
    
    # Clear the user_response from state to prepare for future interactions
    if "user_response" in state:
        state.pop("user_response")
    
    # Return to END with the updated messages
    await copilotkit_exit(config)
    return Command(
        goto=END,
        update={
            "messages": messages,
        }
    )


# Define the graph
workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node("start_flow", start_flow)
workflow.add_node("chat_node", chat_node)
workflow.add_node(INTERRUPTED_NODE_NAME, interrupted_node)

# Add edges
workflow.set_entry_point("start_flow")
workflow.add_edge(START, "start_flow")
workflow.add_edge("start_flow", "chat_node")
workflow.add_edge(INTERRUPTED_NODE_NAME, END)

# Add conditional edges from chat_node
def should_continue(command: Command):
    if command.goto == INTERRUPTED_NODE_NAME:
        return INTERRUPTED_NODE_NAME
    else:
        return END

workflow.add_conditional_edges(
    "chat_node",
    should_continue,
    {
        INTERRUPTED_NODE_NAME: INTERRUPTED_NODE_NAME,
        END: END,
    },
)

# Compile the graph
human_in_the_loop_graph = workflow.compile(checkpointer=MemorySaver())