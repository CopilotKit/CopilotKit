"""Agents"""

import re
from typing import Optional, List, TypedDict
from abc import ABC, abstractmethod
from .types import Message
from .action import ActionDict
from .types import MetaEvent

class AgentDict(TypedDict):
    """Legacy agent dictionary."""
    name: str
    description: Optional[str]

class RuntimeAgentDescriptionDict(TypedDict):
    """Runtime agent description used by the JS runtime discovery contract."""
    name: str
    description: str
    className: str

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
        config: Optional[dict] = None,
        messages: List[Message],
        thread_id: str,
        actions: Optional[List[ActionDict]] = None,
        meta_events: Optional[List[MetaEvent]] = None,
        **kwargs,
    ):
        """Execute the agent"""

    @abstractmethod
    async def get_state(
        self,
        *,
        thread_id: str,
    ):
        """Default get_state implementation"""
        return {
            "threadId": thread_id or "",
            "threadExists": False,
            "state": {},
            "messages": []
        }


    def dict_repr(self) -> AgentDict:
        """Legacy dict representation kept for backwards compatibility."""
        return {
            'name': self.name,
            'description': self.description or ''
        }

    def runtime_info_repr(self) -> RuntimeAgentDescriptionDict:
        """Runtime info representation aligned with the JS runtime contract."""
        return {
            'name': self.name,
            'description': self.description or '',
            'className': self.__class__.__name__,
        }
