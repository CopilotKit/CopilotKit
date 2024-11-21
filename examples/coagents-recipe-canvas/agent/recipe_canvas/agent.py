"""
This is the main entry point for the Recipe Agent.
It defines the workflow graph and the entry point for the agent.
"""
# pylint: disable=line-too-long, unused-import
import json
from typing import cast

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from recipe_canvas.state import AgentState
from recipe_canvas.download import download_node
from recipe_canvas.chat import chat_node
from recipe_canvas.search import search_node
from recipe_canvas.modify import modify_node

# Define a new graph
workflow = StateGraph(AgentState)
workflow.add_node("download", download_node)
workflow.add_node("chat_node", chat_node)
workflow.add_node("search_node", search_node)
workflow.add_node("modify_node", modify_node)

def route(state):
    """Route after the chat node."""

    messages = state.get("messages", [])
    if messages and isinstance(messages[-1], AIMessage):
        ai_message = cast(AIMessage, messages[-1])

        if ai_message.tool_calls and ai_message.tool_calls[0]["name"] == "SearchRecipes":
            return "search_node"
        if ai_message.tool_calls and ai_message.tool_calls[0]["name"] == "ModifyRecipe":
            return "modify_node"
    if messages and isinstance(messages[-1], ToolMessage):
        return "chat_node"

    return END


memory = MemorySaver()
workflow.set_entry_point("download")
workflow.add_edge("download", "chat_node")
workflow.add_conditional_edges("chat_node", route, ["search_node", "chat_node", "modify_node", END])
workflow.add_edge("search_node", "download")
workflow.add_edge("modify_node", "chat_node")
graph = workflow.compile(checkpointer=memory, interrupt_after=["modify_node"])
