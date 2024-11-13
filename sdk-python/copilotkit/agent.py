"""Agents"""

from typing import Optional, List, TypedDict
from abc import ABC, abstractmethod
from .types import Message
from .action import ActionDict

class AgentDict(TypedDict):
    """Agent dictionary"""
    name: str
    description: Optional[str]

class Agent(ABC):
    """Agent class for CopilotKit"""
    def __init__(
            self,
            *,
            name: str,
            description: Optional[str] = None,
        ):
        self.name = name
        self.description = description

    @abstractmethod
    def execute( # pylint: disable=too-many-arguments
        self,
        *,
        state: dict,
        messages: List[Message],
        thread_id: Optional[str] = None,
        node_name: Optional[str] = None,
        actions: Optional[List[ActionDict]] = None,
    ):
        """Execute the agent"""

    def dict_repr(self) -> AgentDict:
        """Dict representation of the action"""
        return {
            'name': self.name,
            'description': self.description or ''
        }
