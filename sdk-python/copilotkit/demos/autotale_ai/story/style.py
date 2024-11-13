"""
Style node.
"""

import json
from langchain_core.tools import tool
from copilotkit.demos.autotale_ai.state import AgentState

@tool
def set_style(style: str):
    """Sets the graphical style of the story."""
    return style


async def style_node(state: AgentState):
    """
    The style node is responsible for setting the graphical style of the story.
    """
    last_message = state["messages"][-1]
    return {
        "style": json.loads(last_message.content)["style"]
    }
