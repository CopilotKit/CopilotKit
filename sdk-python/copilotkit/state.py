"""CopilotKit state"""

from typing import List, Any, TypedDict
from langgraph.graph import MessagesState

class CopilotKitProperties(TypedDict):
    """CopilotKit state"""
    actions: List[Any]

class CopilotKitState(MessagesState):
    """CopilotKit state"""
    copilotkit: CopilotKitProperties
