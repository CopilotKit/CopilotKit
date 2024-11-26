"""
This is the main entry point for the AI.
It defines the workflow graph and the entry point for the agent.
"""
# pylint: disable=line-too-long, unused-import
from typing import cast
from langchain_core.messages import ToolMessage, AIMessage
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from travel.trips import trips_node
from travel.chat import chat_node
from travel.search import search_node
from travel.trips import perform_trips_node
from travel.state import AgentState

# Route is responsible for determing the next node based on the last message. This
# is needed because LangGraph does not automatically route to nodes, instead that
# is handled through code.
def route(state: AgentState):
    """Route after the chat node."""
    messages = state.get("messages", [])
    if messages and isinstance(messages[-1], AIMessage):
        ai_message = cast(AIMessage, messages[-1])
        
        # If the last AI message has tool calls we need to determine to route to the
        # trips_node or search_node based on the tool name.
        if ai_message.tool_calls:
            tool_name = ai_message.tool_calls[0]["name"]
            if tool_name in ["add_trips", "update_trips", "delete_trips", "select_trip"]:
                return "trips_node"
            if tool_name in ["search_for_places"]:
                return "search_node"
            return "chat_node"
    
    if messages and isinstance(messages[-1], ToolMessage):
        return "chat_node"
    
    return END

graph_builder = StateGraph(AgentState)

graph_builder.add_node("chat_node", chat_node)
graph_builder.add_node("trips_node", trips_node)
graph_builder.add_node("search_node", search_node)
graph_builder.add_node("perform_trips_node", perform_trips_node)

graph_builder.add_conditional_edges("chat_node", route, ["search_node", "chat_node", "trips_node", END])

graph_builder.add_edge(START, "chat_node")
graph_builder.add_edge("search_node", "chat_node")
graph_builder.add_edge("perform_trips_node", "chat_node")
graph_builder.add_edge("trips_node", "perform_trips_node")

graph = graph_builder.compile(
    checkpointer=MemorySaver(),
)
