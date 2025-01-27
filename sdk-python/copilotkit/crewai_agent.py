"""
CrewAI Agent
"""

import uuid
import json
import asyncio
from typing import Optional, List, Mapping, Callable
from typing_extensions import TypedDict, NotRequired, Any
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
from .crewai import (
  CREWAI_FLOW_EVENT_QUEUE,
  copilotkit_emit_state,
  copilotkit_message_to_crewai_crew,
  copilotkit_messages_to_crewai_flow,
  CopilotKitCrewAIFlowEventType
)

async def example_function():
    """Example function"""
    await asyncio.sleep(1)
    await copilotkit_emit_state("test 1")
    await asyncio.sleep(1)
    await copilotkit_emit_state("test 2")
    await asyncio.sleep(1)
    await copilotkit_emit_state("test 3")
    await asyncio.sleep(1)


def crewai_default_merge_state( # pylint: disable=unused-argument
        *,
        state: dict,
        messages: List[Any],
        actions: List[Any],
        agent_name: str,
        thread_id: Optional[str] = None
    ):
    """Default merge state for CrewAI"""
    return {
        **state,
        "id": thread_id,
        "messages": messages,
        "copilotkit": {
            "actions": actions
        }
    }

class CopilotKitConfig(TypedDict):
    """
    CopilotKit config for CrewAIAgent
    """
    merge_state: NotRequired[Callable]

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
            copilotkit_config: Optional[CopilotKitConfig] = None,
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
        self.copilotkit_config = copilotkit_config or {}

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

        return self.execute_flow(
            state=state,
            messages=messages,
            thread_id=thread_id,
            actions=actions,
            **kwargs
        )

    async def execute_flow( # pylint: disable=too-many-arguments,unused-argument
        self,
        *,
        state: dict,
        messages: List[Message],
        thread_id: Optional[str] = None,
        actions: Optional[List[ActionDict]] = None,
        **kwargs,
    ):
        """Execute a `Flow` based agent"""

        merge_state = self.copilotkit_config.get("merge_state", crewai_default_merge_state)

        # check the crew state if it supports messages, i.e. is a subclass of CopilotKitState

        crewai_flow_messages = copilotkit_messages_to_crewai_flow(messages)
        state = merge_state(
            state=state,
            messages=crewai_flow_messages,
            actions=actions,
            agent_name=self.name
        )

        # Create a local queue to receive events
        local_queue = asyncio.Queue()

        # Set the local queue as the event queue
        token = CREWAI_FLOW_EVENT_QUEUE.set(local_queue)
        try:
            # Run the flow as a task
            task = asyncio.create_task(self.flow.kickoff(inputs=state))

            # While the function is running, pull items from local_queue
            while not task.done():
                done, pending = await asyncio.wait(
                    {task, asyncio.create_task(local_queue.get())},
                    return_when=asyncio.FIRST_COMPLETED
                )
                if task in done:
                    # flow is done
                    break

                # Otherwise, we got an event from local_queue
                queue_task = next(iter(done))
                event_data = queue_task.result()

                # TODO: move this to a function
                if event_data["type"] == CopilotKitCrewAIFlowEventType.EMIT_MESSAGE:
                    yield emit_runtime_events(
                        text_message_start(message_id=event_data["message_id"]),
                        text_message_content(
                            message_id=event_data["message_id"],
                            content=event_data["message"]
                        ),
                        text_message_end(message_id=event_data["message_id"])
                    )
                elif event_data["type"] == CopilotKitCrewAIFlowEventType.EMIT_TOOL_CALL:
                    yield emit_runtime_events(
                        action_execution_start(
                            action_execution_id=event_data["message_id"],
                            action_name=event_data["name"]
                        ),
                        action_execution_args(
                            action_execution_id=event_data["message_id"],
                            args=json.dumps(event_data["args"])
                        ),
                        action_execution_end(action_execution_id=event_data["message_id"])
                    )

                # Cancel the still-pending queue.get() so we can re-create in the next loop
                for p in pending:
                    if p is not task:
                        p.cancel()

            # Make sure the flow actually had no exceptions
            await task



        finally:
            # Restore the original context state
            CREWAI_FLOW_EVENT_QUEUE.reset(token)

    def execute_crew( # pylint: disable=too-many-arguments,unused-argument
        self,
        *,
        state: dict,
        messages: List[Message],
        thread_id: Optional[str] = None,
        actions: Optional[List[ActionDict]] = None,
        **kwargs,
    ):
        """Execute a `Crew` based agent"""

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
            [copilotkit_message_to_crewai_crew(message) for message in messages]
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
