"""
Outline node.
"""

import json
from langchain_core.tools import tool
from copilotkit.demos.autotale_ai.state import AgentState

@tool
def set_outline(outline: str):
    """Sets the outline of the story."""
    return outline


async def outline_node(state: AgentState):
    """
    The outline node is responsible for generating an outline for the story.
    """
    last_message = state["messages"][-1]
    return {
        "outline": json.loads(last_message.content)["outline"]
    }
