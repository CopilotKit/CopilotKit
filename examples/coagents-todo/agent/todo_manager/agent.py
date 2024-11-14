"""
This is the main entry point for the AI.
It defines the workflow graph and the entry point for the agent.
"""
# pylint: disable=line-too-long, unused-import
from typing import cast
from langchain_core.messages import ToolMessage, AIMessage
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver
from todo_manager.todos import todo_node
from todo_manager.chat import chat_node, tools
from todo_manager.state import AgentState

# Route is responsible for determing the next node based on the last message. This
# is needed because LangGraph does not automatically route to nodes, instead that
# is handled through code.
def route(state: AgentState):
    """Route after the chat node."""
    messages = state.get("messages", [])
    if messages and isinstance(messages[-1], AIMessage):
        ai_message = cast(AIMessage, messages[-1])
        
        # If the last AI message has tool calls we need to determine to route to the
        # todo_node or tools_node based on the tool name.
        if ai_message.tool_calls:
            tool_name = ai_message.tool_calls[0]["name"]
            if tool_name in ["add_todos", "update_todos", "delete_todos"]:
                return "todo_node"
            return "tools_node"
    
    if messages and isinstance(messages[-1], ToolMessage):
        return "chat_node"
    
    return END

graph_builder = StateGraph(AgentState)

graph_builder.add_node("chat_node", chat_node)
graph_builder.add_node("tools_node", ToolNode(tools=tools))
graph_builder.add_node("todo_node", todo_node)

graph_builder.add_conditional_edges("chat_node", route, ["tools_node", "chat_node", "todo_node", END])

graph_builder.add_edge(START, "chat_node")
graph_builder.add_edge("tools_node", "chat_node")
graph_builder.add_edge("todo_node", "chat_node")
graph_builder.add_edge("chat_node", END)

graph = graph_builder.compile(checkpointer=MemorySaver())