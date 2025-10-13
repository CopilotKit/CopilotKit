"""
A demo of predictive state updates using LangGraph.
"""

import json
import uuid
from typing import Dict, List, Any, Optional

# LangGraph imports
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END, START
from langgraph.types import Command

# CopilotKit imports
from copilotkit import CopilotKitState
from copilotkit.langgraph import (
    copilotkit_customize_config
)
from copilotkit.langgraph import (copilotkit_exit)
# OpenAI imports
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage

WRITE_DOCUMENT_TOOL = {
    "type": "function",
    "function": {
        "name": "write_document",
        "description": " ".join("""
            Write a document. Use markdown formatting to format the document.
            It's good to format the document extensively so it's easy to read.
            You can use all kinds of markdown.
            However, do not use italic or strike-through formatting, it's reserved for another purpose.
            You MUST write the full document, even when changing only a few words.
            When making edits to the document, try to make them minimal - do not change every word.
            Keep stories SHORT!
            """.split()),
        "parameters": {
            "type": "object",
            "properties": {
                "document": {
                    "type": "string",
                    "description": "The document to write"
                },
            },
        }
    }
}


class AgentState(CopilotKitState):
    """
    The state of the agent.
    """
    document: Optional[str] = None


async def start_flow(state: AgentState, config: RunnableConfig):
    """
    This is the entry point for the flow.
    """
    return Command(
        goto="chat_node"
    )


async def chat_node(state: AgentState, config: RunnableConfig):
    """
    Standard chat node.
    """

    system_prompt = f"""
    You are a helpful assistant for writing documents. 
    To write the document, you MUST use the write_document tool.
    You MUST write the full document, even when changing only a few words.
    When you wrote the document, DO NOT repeat it as a message. 
    Just briefly summarize the changes you made. 2 sentences max.
    This is the current state of the document: ----\n {state.get('document')}\n-----
    """

    # Define the model
    model = ChatOpenAI(model="gpt-4o")
    
    # Define config for the model with emit_intermediate_state to stream tool calls to frontend
    if config is None:
        config = RunnableConfig(recursion_limit=25)
    
    # Use CopilotKit's custom config to set up streaming for the write_document tool
    # This is equivalent to copilotkit_predict_state in the CrewAI version
    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[{
            "state_key": "document",
            "tool": "write_document",
            "tool_argument": "document",
        }],
    )

    # Bind the tools to the model
    model_with_tools = model.bind_tools(
        [
            *state["copilotkit"]["actions"],
            WRITE_DOCUMENT_TOOL
        ],
        # Disable parallel tool calls to avoid race conditions
        parallel_tool_calls=False,
    )

    # Run the model to generate a response
    response = await model_with_tools.ainvoke([
        SystemMessage(content=system_prompt),
        *state["messages"],
    ], config)

    # Update messages with the response
    messages = state["messages"] + [response]
    
    # Extract any tool calls from the response
    if hasattr(response, "tool_calls") and response.tool_calls:
        tool_call = response.tool_calls[0]
        
        # Handle tool_call as a dictionary or an object
        if isinstance(tool_call, dict):
            tool_call_id = tool_call["id"]
            tool_call_name = tool_call["name"]
            tool_call_args = tool_call["args"]
        else:
            # Handle as an object (backward compatibility)
            tool_call_id = tool_call.id
            tool_call_name = tool_call.name
            tool_call_args = tool_call.args

        if tool_call_name == "write_document":
            # Add the tool response to messages
            tool_response = {
                "role": "tool",
                "content": "Document written.",
                "tool_call_id": tool_call_id
            }
            
            # Add confirmation tool call
            confirm_tool_call = {
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "id": str(uuid.uuid4()),
                    "function": {
                        "name": "confirm_changes",
                        "arguments": "{}"
                    }
                }]
            }
            
            messages = messages + [tool_response, confirm_tool_call]
            
            # Return Command to route to end
            await copilotkit_exit(config)
            return Command(
                goto=END,
                update={
                    "messages": messages,
                    "document": tool_call_args["document"]
                }
            )
    
    # If no tool was called, go to end
    await copilotkit_exit(config)
    return Command(
        goto=END,
        update={
            "messages": messages
        }
    )


# Define the graph
workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node("start_flow", start_flow)
workflow.add_node("chat_node", chat_node)

# Add edges
workflow.set_entry_point("start_flow")
workflow.add_edge(START, "start_flow")
workflow.add_edge("start_flow", "chat_node")
workflow.add_edge("chat_node", END)

# Compile the graph
predictive_state_updates_graph = workflow.compile()
