"""
CrewAI Agent
"""

import uuid
from typing import Optional, List
from crewai import Crew, Flow
from .agent import Agent
from .types import Message
from .action import ActionDict
from .protocol import (
  emit_runtime_events,
  text_message_start,
  text_message_content,
  text_message_end
)

class CrewAIAgent(Agent):
    """Agent class for CopilotKit"""
    def __init__(
            self,
            *,
            name: str,
            description: Optional[str] = None,
            crew: Optional[Crew] = None,
            flow: Optional[Flow] = None,
        ):
        super().__init__(
            name=name,
            description=description,
        )
        if (crew is None) == (flow is None):
            raise ValueError("Either crew or flow must be provided to CrewAIAgent")


        self.crew = crew
        self.flow = flow


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
        message_id = str(uuid.uuid4())

        yield emit_runtime_events(
            text_message_start(message_id=message_id),
            text_message_content(message_id=message_id, content="Hello, world!"),
            text_message_end(message_id=message_id)
        )

    def dict_repr(self):
        super_repr = super().dict_repr()
        return {
            **super_repr,
            'type': 'crewai'
        }
