"""
CrewAI Agent
"""

import uuid
import json
from typing import Optional, List, Any, Mapping
from crewai import Crew, Flow
from .agent import Agent
from .types import Message
from .action import ActionDict
from .protocol import (
  emit_runtime_events,
  text_message_start,
  text_message_content,
  text_message_end,
  action_execution_start,
  action_execution_args,
  action_execution_end
)

class CrewAIAgent(Agent):
    """Agent class for CopilotKit"""
    def __init__(
            self,
            *,
            name: str,
            description: Optional[str] = None,
            crew: Optional[Crew] = None,
            crew_input_key: Optional[str] = None,            
            flow: Optional[Flow] = None,
        ):
        super().__init__(
            name=name,
            description=description,
        )
        if (crew is None) == (flow is None):
            raise ValueError("Either crew or flow must be provided to CrewAIAgent")


        self.crew = crew
        self.crew_input_key = crew_input_key or "input"
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
        if self.crew:
            return self.execute_crew(
                state=state,
                messages=messages,
                thread_id=thread_id,
                actions=actions,
                **kwargs
            )

    def execute_crew( # pylint: disable=too-many-arguments,unused-argument
        self,
        *,
        state: dict,
        messages: List[Message],
        thread_id: Optional[str] = None,
        actions: Optional[List[ActionDict]] = None,
        **kwargs,
    ):
        """Execute the agent"""
        
        crew_text_input = ""
        if len(messages) > 0:
            # filter out the first message if it's a system message
            if "role" in messages[0] and messages[0]["role"] == "system":
                messages = messages[1:]
        
        if len(messages) > 0:
            if "content" in messages[-1]:
                crew_text_input = messages[-1]['content']
            elif "result" in messages[-1]:
                crew_text_input = messages[-1]['result']

        crew_chat_messages = json.dumps(
            [copilotkit_message_to_crewai(message) for message in messages]
        )

        inputs = {
            self.crew_input_key: crew_text_input,
            "crew_chat_messages": crew_chat_messages
        }
        print("Inputs:", inputs, flush=True)
        output = self.crew.kickoff(inputs=inputs)
        print("Output:", output, flush=True)
        message_id = str(uuid.uuid4())

        try:
            json_output = json.loads(output.raw)
            if (isinstance(json_output, Mapping) and
                "__copilotkit_execute_action__" in json_output):
                name = json_output["__copilotkit_execute_action__"]["name"]
                args = json_output["__copilotkit_execute_action__"]["args"]
                yield emit_runtime_events(
                    action_execution_start(action_execution_id=message_id, action_name=name),
                    action_execution_args(action_execution_id=message_id, args=json.dumps(args)),
                    action_execution_end(action_execution_id=message_id)
                )
                return
        except: # pylint: disable=bare-except
            pass


        yield emit_runtime_events(
            text_message_start(message_id=message_id),
            text_message_content(message_id=message_id, content=output.raw),
            text_message_end(message_id=message_id)
        )

    def dict_repr(self):
        super_repr = super().dict_repr()
        return {
            **super_repr,
            'type': 'crewai'
        }

def copilotkit_message_to_crewai(message: Any) -> Any:
    """Convert a CopilotKit message to a CrewAI `Crew` specific message"""

    if "content" in message:
        return {
            'role': message['role'],
            'content': message['content']
        }

    if "name" in message:
        return {
            'role': "assistant",
            'content': f"Executing action {message['name']} with arguments {message['arguments']}"
        }

    if "result" in message:
        return {
            'role': "user",
            'content': f"Action {message['actionName']} completed with result {message['result']}"
        }

    raise ValueError("Invalid message")
