"""Agents"""

import re
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

        if not re.match(r"^[a-zA-Z0-9_-]+$", name):
            raise ValueError(
                f"Invalid agent name '{name}': " +
                "must consist of alphanumeric characters, underscores, and hyphens only"
            )

    @abstractmethod
    def execute( # pylint: disable=too-many-arguments
        self,
        *,
        state: dict,
        messages: List[Message],
        thread_id: Optional[str] = None,
        actions: Optional[List[ActionDict]] = None,
        **kwargs,
    ):
        """Execute the agent"""

    def get_state(
        self,
        *,
        thread_id: str, # pylint: disable=unused-argument
    ):
        """Get agent state"""
        return {}

    def dict_repr(self) -> AgentDict:
        """Dict representation of the action"""
        return {
            'name': self.name,
            'description': self.description or ''
        }
