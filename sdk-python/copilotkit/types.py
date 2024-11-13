"""State for CopilotKit"""

from typing import TypedDict
from enum import Enum
from typing_extensions import NotRequired

class MessageRole(Enum):
    """Message role"""
    ASSISTANT = "assistant"
    SYSTEM = "system"
    USER = "user"

class Message(TypedDict):
    """Message"""
    id: str
    createdAt: str

class TextMessage(Message):
    """Text message"""
    role: MessageRole
    content: str

class ActionExecutionMessage(Message):
    """Action execution message"""
    name: str
    arguments: dict
    scope: str

class ResultMessage(Message):
    """Result message"""
    actionExecutionId: str
    actionName: str
    result: str

class IntermediateStateConfig(TypedDict):
    """Intermediate state config"""
    state_key: str
    tool: str
    tool_argument: NotRequired[str]
