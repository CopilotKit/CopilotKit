"""
A LangGraph implementation of the human-in-the-loop agent.
"""

import json
from typing import Dict, List, Any

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

DEFINE_TASK_TOOL = {
    "type": "function",
    "function": {
        "name": "generate_task_steps",
        "description": "Make up 10 steps (only a couple of words per step) that are required for a task. The step should be in imperative form (i.e. Dig hole, Open door, ...)",
        "parameters": {
            "type": "object",
            "properties": {
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {
                                "type": "string",
                                "description": "The text of the step in imperative form"
                            },
                            "status": {
                                "type": "string",
                                "enum": ["enabled"],
                                "description": "The status of the step, always 'enabled'"
                            }
                        },
                        "required": ["description", "status"]
                    },
                    "description": "An array of 10 step objects, each containing text and status"
                }
            },
            "required": ["steps"]
        }
    }
}

class AgentState(CopilotKitState):
    """
    The state of the agent.
    It inherits from CopilotKitState which provides the basic fields needed by CopilotKit.
    """
    steps: List[Dict[str, str]] = []

async def start_flow(state: Dict[str, Any], config: RunnableConfig):
    """
    This is the entry point for the flow.
    """

    # Initialize steps list if not exists
    if "steps" not in state:
        state["steps"] = []

    print("Node: start_flow");
    
    return Command(
        goto="chat_node",
        update={
            "messages": state["messages"],
            "steps": state["steps"],
        }
    )


async def chat_node(state: Dict[str, Any], config: RunnableConfig):
    """
    Standard chat node where the agent processes messages and generates responses.
    If task steps are defined, the user can enable/disable them using interrupts.
    """
    system_prompt = """
    You are a helpful assistant that can perform any task.
    You MUST call the `generate_task_steps` function when the user asks you to perform a task. If its a casual conversation, you can skip the function call.
    Always make sure you will provide tasks based on the user query
    """

    print("Node: chat_node");

    # Define the model
    model = ChatOpenAI(model="gpt-4o-mini")
    
    # Define config for the model
    if config is None:
        config = RunnableConfig(recursion_limit=25)
    
    # Use CopilotKit's custom config functions to properly set up streaming for the steps state
    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[{
            "state_key": "steps",
            "tool": "generate_task_steps",
            "tool_argument": "steps"
        }],
    )

    # Bind the tools to the model
    model_with_tools = model.bind_tools(
        [
            *state["copilotkit"]["actions"],
            DEFINE_TASK_TOOL
        ],
        # Disable parallel tool calls to avoid race conditions
        parallel_tool_calls=False,
    )

    # Run the model and generate a response
    response = await model_with_tools.ainvoke([
        SystemMessage(content=system_prompt),
        *state["messages"],
    ], config)

    # Update messages with the response
    messages = state["messages"] + [response]

    print("Messages: ", response)
    
    # Handle tool calls
    if hasattr(response, "tool_calls") and response.tool_calls and len(response.tool_calls) > 0:
        tool_call = response.tool_calls[0]
        # Extract tool call information
        if hasattr(tool_call, "id"):
            tool_call_id = tool_call.id
            tool_call_name = tool_call.name
            tool_call_args = tool_call.args if not isinstance(tool_call.args, str) else json.loads(tool_call.args)
        else:
            tool_call_id = tool_call.get("id", "")
            tool_call_name = tool_call.get("name", "")
            args = tool_call.get("args", {})
            tool_call_args = args if not isinstance(args, str) else json.loads(args)

        if tool_call_name == "generate_task_steps":
            # Get the steps from the tool call
            steps_raw = tool_call_args.get("steps", [])
            
            # Set initial status to "enabled" for all steps
            steps_data = []
            
            # Handle different potential formats of steps data
            if isinstance(steps_raw, list):
                for step in steps_raw:
                    if isinstance(step, dict) and "description" in step:
                        steps_data.append({
                            "description": step["description"],
                            "status": "enabled"
                        })
                    elif isinstance(step, str):
                        steps_data.append({
                            "description": step,
                            "status": "enabled"
                        })
            
            # If no steps were processed correctly, return to END with the updated messages
            if not steps_data:
                await copilotkit_exit(config)
                return Command(
                    goto=END,
                    update={
                        "messages": messages,
                        "steps": state["steps"],
                    }
                )
            # Update steps in state and emit to frontend
            state["steps"] = steps_data
            
            # Add a tool response to satisfy OpenAI's requirements
            tool_response = {
                "role": "tool",
                "content": "Task steps generated.",
                "tool_call_id": tool_call_id
            }
            
            messages = messages + [tool_response]

            # Move to the process_steps_node which will handle the interrupt and final response
            return Command(
                goto="process_steps_node",
                update={
                    "messages": messages,
                    "steps": state["steps"],
                }
            )
    
    # If no tool calls or not generate_task_steps, return to END with the updated messages
    await copilotkit_exit(config)
    return Command(
        goto=END,
        update={
            "messages": messages,
            "steps": state["steps"],
        }
    )


async def process_steps_node(state: Dict[str, Any], config: RunnableConfig):
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
        user_response = interrupt({"steps": state["steps"]})
        # Store the user response in state for when the node restarts
        state["user_response"] = user_response
    
    # Generate the creative completion response
    final_prompt = """
    Provide a textual description of how you are performing the task.
    If the user has disabled a step, you are not allowed to perform that step.
    However, you should find a creative workaround to perform the task, and if an essential step is disabled, you can even use
    some humor in the description of how you are performing the task.
    Don't just repeat a list of steps, come up with a creative but short description (3 sentences max) of how you are performing the task.
    """
    
    final_response = await ChatOpenAI(model="gpt-4o").ainvoke([
        SystemMessage(content=final_prompt),
        {"role": "user", "content": user_response}
    ], config)

    # Add the final response to messages
    messages = state["messages"] + [final_response]
    
    # Clear the user_response from state to prepare for future interactions
    if "user_response" in state:
        state.pop("user_response")
    
    # Return to END with the updated messages
    await copilotkit_exit(config)
    return Command(
        goto=END,
        update={
            "messages": messages,
            "steps": state["steps"],
        }
    )


# Define the graph
workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node("start_flow", start_flow)
workflow.add_node("chat_node", chat_node)
workflow.add_node("process_steps_node", process_steps_node)

# Add edges
workflow.set_entry_point("start_flow")
workflow.add_edge(START, "start_flow")
workflow.add_edge("start_flow", "chat_node")
# workflow.add_edge("chat_node", "process_steps_node") # Removed unconditional edge
workflow.add_edge("process_steps_node", END)
# workflow.add_edge("chat_node", END)                 # Removed unconditional edge

# Add conditional edges from chat_node
def should_continue(command: Command):
    if command.goto == "process_steps_node":
        return "process_steps_node"
    else:
        return END

workflow.add_conditional_edges(
    "chat_node",
    should_continue,
    {
        "process_steps_node": "process_steps_node",
        END: END,
    },
)

# Compile the graph
human_in_the_loop_graph = workflow.compile(checkpointer=MemorySaver())