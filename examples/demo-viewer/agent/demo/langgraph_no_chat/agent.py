"""
A LangGraph implementation of the human-in-the-loop agent.
"""

import json
from typing import Dict, List, Any
import asyncio
# LangGraph imports
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END, START
from langgraph.types import Command, interrupt
from langgraph.checkpoint.memory import MemorySaver

# CopilotKit imports
from copilotkit import CopilotKitState
from copilotkit.langgraph import copilotkit_customize_config, copilotkit_emit_state, copilotkit_interrupt

# LLM imports
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage
from copilotkit.langgraph import (copilotkit_exit)

class AgentState(CopilotKitState):
    """
    The state of the agent.
    It inherits from CopilotKitState which provides the basic fields needed by CopilotKit.
    """

async def start_flow(state: AgentState, config: RunnableConfig):
    """
    This is the entry point for the flow.
    """
    
    await asyncio.sleep(1)
    return Command(
        goto="buffer_node",
        update={
            "messages": state["messages"]
        }
    )


async def buffer_node(state: AgentState, config: RunnableConfig):
    """
    This is a buffer node.
    """
    system_prompt = """
    You are a helpful assistant that answers user's questions. Make sure the response is concise and to the point. The response format should strictly be in markdown format.
    """
    await asyncio.sleep(0)

    # Define the model
    model = ChatOpenAI(model="gpt-4o-mini")
    
    # Define config for the model
    if config is None:
        config = RunnableConfig(recursion_limit=25)
    
    # Use CopilotKit's custom config functions to properly set up streaming for the steps state
    config = copilotkit_customize_config(
        config
    )

    # Bind the tools to the model
    model_with_tools = model.bind_tools(
        tools=[],
        parallel_tool_calls=False,
    )

    # Run the model and generate a response
    response = await model_with_tools.ainvoke([
        SystemMessage(content=system_prompt),
        *state["messages"],
    ], config)

    # Update messages with the response
    messages = state["messages"] + [response]

    # If no tool calls or not generate_task_steps, return to END with the updated messages
    await copilotkit_exit(config)
    return Command(
        goto="confirming_response_node",
        update={
            "messages": messages
        }
    )


async def confirming_response_node(state: AgentState, config: RunnableConfig):
    """
    This is a buffer node as well. Just the name is
    """
    
    await asyncio.sleep(1)
    await copilotkit_exit(config)
    return Command(
        goto="reporting_node",
        update={
            "messages": state["messages"]
        }
    )



async def reporting_node(state: AgentState, config: RunnableConfig):
    """
    This node handles the user interrupt for step customization and generates the final response.
    """

    await asyncio.sleep(1)
    await copilotkit_exit(config)
    return Command(
        goto=END,
        update={
            "messages": state["messages"]
        }
    )


# Define the graph
workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node("start_flow", start_flow)
workflow.add_node("buffer_node", buffer_node)
workflow.add_node("confirming_response_node", confirming_response_node)
workflow.add_node("reporting_node", reporting_node)

# Add edges
workflow.set_entry_point("start_flow")
workflow.add_edge(START, "start_flow")
workflow.add_edge("start_flow", "buffer_node")
workflow.add_edge("buffer_node", "confirming_response_node")
workflow.add_edge("confirming_response_node", "reporting_node")
workflow.add_edge("reporting_node", END)


# Compile the graph
no_chat = workflow.compile(checkpointer=MemorySaver())