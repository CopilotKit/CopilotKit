"""
An example demonstrating tool-based generative UI using LangGraph.
"""

from typing import Dict, List, Any, Optional

# LangGraph imports
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END, START
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

# CopilotKit imports
from copilotkit import CopilotKitState
from copilotkit.langgraph import copilotkit_customize_config

# OpenAI imports
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage


# This tool generates a haiku on the server.
# The tool call will be streamed to the frontend as it is being generated.
GENERATE_HAIKU_TOOL = {
    "type": "function",
    "function": {
        "name": "generate_haiku",
        "description": "Generate a haiku in Japanese and its English translation",
        "parameters": {
            "type": "object",
            "properties": {
                "japanese": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "description": "An array of three lines of the haiku in Japanese"
                },
                "english": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "description": "An array of three lines of the haiku in English"
                }
            },
            "required": ["japanese", "english"]
        }
    }
}


async def chat_node(state: CopilotKitState, config: RunnableConfig):
    """
    The main function handling chat and tool calls.
    """
    system_prompt = "You assist the user in generating a haiku."

    # Define the model
    model = ChatOpenAI(model="gpt-4o")
    
    # Define config for the model
    if config is None:
        config = RunnableConfig(recursion_limit=25)
    
    # Use CopilotKit's custom config to set up streaming
    config = copilotkit_customize_config(config)

    # Bind the tools to the model
    model_with_tools = model.bind_tools(
        [GENERATE_HAIKU_TOOL],
        # Disable parallel tool calls to avoid race conditions
        parallel_tool_calls=False,
    )

    # Run the model to generate a response
    response = await model_with_tools.ainvoke([
        SystemMessage(content=system_prompt),
        *state["messages"],
    ], config)

    # Return Command to end with updated messages
    return Command(
        goto=END,
        update={
            "messages": state["messages"] + [response]
        }
    )

# Define the graph
workflow = StateGraph(CopilotKitState)

# Add nodes
workflow.add_node("chat_node", chat_node)

# Add edges
workflow.set_entry_point("chat_node")
workflow.add_edge(START, "chat_node")
workflow.add_edge("chat_node", END)

# Create memory saver
memory = MemorySaver()

# Compile the graph
tool_based_generative_ui_graph = workflow.compile(
    checkpointer=memory
)

