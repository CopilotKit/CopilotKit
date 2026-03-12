"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

from typing import Annotated
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

class State(TypedDict):
    messages: Annotated[list, add_messages]

async def chat_node(state: State):
    return {"messages": state["messages"] + [{"role": "assistant", "content": "This is a test message"}]}

# Define the workflow graph
workflow = StateGraph(State)
workflow.add_edge(START, "chat_node")
workflow.add_node("chat_node", chat_node)
workflow.add_edge("chat_node", END)

graph = workflow.compile()
