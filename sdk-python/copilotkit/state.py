"""CopilotKit state"""

from typing import List, Any
from typing_extensions import TypedDict
from langgraph.graph import MessagesState

class CopilotKitProperties(TypedDict):
    """CopilotKit state"""
    actions: List[Any]

class CopilotKitState(MessagesState):
    """CopilotKit state"""
    copilotkit: CopilotKitProperties
