"""
Characters node.
"""

from typing import List
import json
from langchain_core.tools import tool

from copilotkit.demos.autotale_ai.state import AgentState, Character



@tool
def set_characters(characters: List[Character]):
    """
    Extract the book's main characters from the conversation.
    The traits should be short: 3-4 adjectives.
    The appearance should be as detailed as possible. What they look like, their clothes, etc.
    """
    return characters


def characters_node(state: AgentState):
    """
    The characters node is responsible for extracting the characters from the conversation.
    """
    last_message = state["messages"][-1]
    return {
        "characters": json.loads(last_message.content)["characters"]
    }
