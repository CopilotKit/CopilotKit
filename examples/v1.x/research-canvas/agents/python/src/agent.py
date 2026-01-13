"""
This is the main entry point for the AI.
It defines the workflow graph and the entry point for the agent.
"""

import os

from langgraph.graph import StateGraph

from src.lib.chat import chat_node
from src.lib.delete import delete_node, perform_delete_node
from src.lib.download import download_node
from src.lib.search import search_node
from src.lib.state import AgentState

# Define a new graph
workflow = StateGraph(AgentState)
workflow.add_node("download", download_node)
workflow.add_node("chat_node", chat_node)
workflow.add_node("search_node", search_node)
workflow.add_node("delete_node", delete_node)
workflow.add_node("perform_delete_node", perform_delete_node)


workflow.set_entry_point("download")
workflow.add_edge("download", "chat_node")
workflow.add_edge("delete_node", "perform_delete_node")
workflow.add_edge("perform_delete_node", "chat_node")
workflow.add_edge("search_node", "download")

# Conditionally use a checkpointer based on the environment
# This allows compatibility with both LangGraph API and CopilotKit
compile_kwargs = {"interrupt_after": ["delete_node"]}


# Check if we're running in LangGraph API mode
if os.environ.get("LANGGRAPH_FASTAPI", "false").lower() == "false":
    # When running in LangGraph API, don't use a custom checkpointer
    graph = workflow.compile(**compile_kwargs)
else:
    # For CopilotKit and other contexts, use MemorySaver
    from langgraph.checkpoint.memory import MemorySaver

    memory = MemorySaver()
    compile_kwargs["checkpointer"] = memory
    graph = workflow.compile(**compile_kwargs)
