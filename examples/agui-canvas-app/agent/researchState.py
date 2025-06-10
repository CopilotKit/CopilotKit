"""
This is the state definition for the AI.
It defines the state of the agent and the state of the conversation.
"""

from typing import List, TypedDict, Any
from langgraph.graph import MessagesState
from copilotkit import CopilotKitState
class Resource(TypedDict):
    """
    Represents a resource. Give it a good title and a short description.
    """
    url: str
    title: str
    description: str

class Log(TypedDict):
    """
    Represents a log of an action performed by the agent.
    """
    message: str
    done: bool

class AgentState(CopilotKitState):
    """
    This is the state of the agent.
    It is a subclass of the MessagesState class from langgraph.
    """
    research_question: str
    report: str
    resources: List[Resource]
    logs: List[Log]