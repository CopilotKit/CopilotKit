"""
CrewAI Agent
"""

import uuid
import json
import asyncio
from copy import deepcopy
from typing import Optional, List, Callable
from typing_extensions import TypedDict, NotRequired, Any, Dict, cast
from crewai import Crew, Flow
from crewai.flow import start
from crewai.cli.crew_chat import (
  initialize_chat_llm as crew_chat_initialize_chat_llm,
  generate_crew_chat_inputs as crew_chat_generate_crew_chat_inputs,
  generate_crew_tool_schema as crew_chat_generate_crew_tool_schema,
  build_system_message as crew_chat_build_system_message,
  create_tool_function as crew_chat_create_tool_function
)
from litellm import completion
from .agent import Agent
from .types import Message
from .action import ActionDict
from .protocol import (
  emit_runtime_events,
  agent_state_message,
)
from .crewai import (
  copilotkit_messages_to_crewai_flow,
  crewai_flow_messages_to_copilotkit,
  crewai_flow_async_runner,
  copilotkit_stream,
  copilotkit_exit
)

from .runloop import copilotkit_run, CopilotKitRunExecution

class CopilotKitConfig(TypedDict):
    """
    CopilotKit config for CrewAIAgent

    This is used for advanced cases where you want to customize how CopilotKit interacts with
    CrewAI.

    ```python
    # Function signatures:
    def merge_state(
        *,
        state: dict,
        messages: List[BaseMessage],
        actions: List[Any],
        agent_name: str
    ):
        # ...implementation...

    ```

    Parameters
    ----------
    merge_state : Callable
        This function lets you customize how CopilotKit merges the agent state.
    """
    merge_state: NotRequired[Callable]

class CrewAIFlowExecutionState(TypedDict):
    """
    State for an execution of a CrewAI Flow agent
    """
    should_exit: bool
    node_name: str
    is_finished: bool
    predict_state_configuration: Dict[str, Any]
    predicted_state: Dict[str, Any]
    argument_buffer: str
    current_tool_call: Optional[str]

class CrewAIAgent(Agent):
    """
    CrewAIAgent lets you define your agent for use with CopilotKit.

    To install, run:

    ```bash
    pip install copilotkit
    ```

    Every agent must have the `name` and either `crew` or `flow` properties defined. An optional 
    `description` can also be provided. This is used when CopilotKit is dynamically routing requests 
    to the agent.

    ## Serving a Crew based agent

    To serve a Crew based agent, pass in a `Crew` object to the `crew` parameter.

    Note:
    You need to make sure to have a `chat_llm` set on the `Crew` object.
    See [the CrewAI docs](https://docs.crewai.com/concepts/cli#9-chat) for more information.

    ```python
    from copilotkit import CrewAIAgent


    CrewAIAgent(
        name="email_agent_crew",
        description="This crew based agent sends emails",
        crew=SendEmailCrew(),
    )
    ```

    ## Serving a Flow based agent

    To serve a Flow based agent, pass in a `Flow` object to the `flow` parameter.

    ```python
    CrewAIAgent(
        name="email_agent_flow",
        description="This flow based agent sends emails",
        flow=SendEmailFlow(),
    )
    ```

    Note:
    Either a `crew` or `flow` must be provided to CrewAIAgent.

    Parameters
    ----------
    name : str
        The name of the agent.
    crew : Crew
        When using a Crew based agent, pass in a `Crew` object to the `crew` parameter.
    flow : Flow
        When using a Flow based agent, pass in a `Flow` object to the `flow` parameter.
    description : Optional[str]
        The description of the agent.
    copilotkit_config : Optional[CopilotKitConfig]
        The CopilotKit config to use with the agent.

    """
    def __init__(
            self,
            *,
            name: str,
            description: Optional[str] = None,
            crew: Optional[Crew] = None,
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
            crew = deepcopy(self.crew)
            return self.execute_crew(
                state=state,
                messages=messages,
                thread_id=thread_id,
                actions=actions,
                crew=crew,
                **kwargs
            )

        flow = deepcopy(self.flow)
        return self.execute_flow(
            state=state,
            messages=messages,
            thread_id=thread_id,
            actions=actions,
            flow=flow,
            **kwargs
        )

    def execute_crew( # pylint: disable=too-many-arguments,unused-argument
        self,
        *,
        state: dict,
        messages: List[Message],
        thread_id: Optional[str] = None,
        actions: Optional[List[ActionDict]] = None,
        crew: Optional[Crew] = None,
        **kwargs,
    ):
        """Execute a `Crew` based agent"""                

        flow = ChatWithCrewFlow(crew=crew, crew_name=self.name, thread_id=thread_id)

        return self.execute_flow(
            state=state,
            messages=messages,
            thread_id=thread_id,
            actions=actions,
            flow=flow,
            **kwargs
        )


    async def execute_flow( # pylint: disable=too-many-arguments,unused-argument,too-many-locals
        self,
        *,
        state: dict,
        messages: List[Message],
        thread_id: Optional[str] = None,
        actions: Optional[List[ActionDict]] = None,
        flow: Flow,
        **kwargs,
    ):
        """Execute a `Flow` based agent"""

        if thread_id is None:
            raise ValueError("Thread ID is required")

        run_id = str(uuid.uuid4())


        merge_state = self.copilotkit_config.get("merge_state", crewai_flow_default_merge_state)

        crewai_flow_messages = copilotkit_messages_to_crewai_flow(messages)

        state = merge_state(
            state=state,
            messages=crewai_flow_messages,
            actions=actions or [],
            agent_name=self.name,
            flow=flow
        )

        execution: CopilotKitRunExecution = CopilotKitRunExecution(
            thread_id=thread_id,
            agent_name=self.name,
            run_id=run_id,
            should_exit=False,
            node_name="start",
            is_finished=False,
            predict_state_configuration={},
            predicted_state={},
            argument_buffer="",
            current_tool_call=None,
            state=state
        )


        async for event in copilotkit_run(
            fn=lambda: crewai_flow_async_runner(flow, deepcopy(state)),
            execution=execution
        ):
            yield event

        state = {**flow.state}
        if "messages" in state:
            state["messages"] = crewai_flow_messages_to_copilotkit(state["messages"])

        # emit the final state
        yield emit_runtime_events(
            agent_state_message(
                thread_id=thread_id,
                agent_name=self.name,
                node_name=execution["node_name"],
                run_id=run_id,
                active=False,
                role="assistant",
                state=json.dumps(filter_state(state, exclude_keys=["id"])),
                running=not execution["should_exit"]
            )
        )

    def dict_repr(self):
        super_repr = super().dict_repr()
        return {
            **super_repr,
            'type': 'crewai'
        }

def crewai_flow_default_merge_state( # pylint: disable=unused-argument, too-many-arguments
        *,
        state: dict,
        flow: Flow,
        messages: List[Any],
        actions: List[Any],
        agent_name: str,
    ):
    """Default merge state for CrewAI"""
    if len(messages) > 0:
        if "role" in messages[0] and messages[0]["role"] == "system":
            messages = messages[1:]


    actions = [{
        "type": "function",
        "function": {
            **action,
        }
    } for action in actions]

    new_state = {
        **state,
        "messages": messages,
        "copilotkit": {
            "actions": actions
        }
    }

    return new_state


def filter_state(state: Dict[str, Any], exclude_keys: Optional[List[str]] = None) -> Dict[str, Any]:
    """Filter out messages and id from the state"""
    exclude_keys = exclude_keys or ["messages", "id"]
    return {k: v for k, v in state.items() if k not in exclude_keys}

CREW_EXIT_TOOL = {
    "type": "function",
    "function": {
        "name": "crew_exit",
        "description": "Call this when the user has indicated that they are done with the crew",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}


class ChatWithCrewFlow(Flow):
    """Chat with crew"""

    def __init__(self, *, crew: Crew, crew_name: str, thread_id: str):
        super().__init__()
        self.crew = crew.crew()

        if self.crew.chat_llm is None:
            raise ValueError("Crew chat LLM is not set")

        self.crew_name = crew_name
        self.thread_id = thread_id
        self.chat_llm = crew_chat_initialize_chat_llm(self.crew)
        self.crew_chat_inputs = crew_chat_generate_crew_chat_inputs(self.crew, self.crew_name, self.chat_llm)
        self.crew_tool_schema = crew_chat_generate_crew_tool_schema(self.crew_chat_inputs)
        self.system_message = crew_chat_build_system_message(self.crew_chat_inputs)

        super().__init__()

    @start()
    async def chat(self):
        """Chat with the crew"""
        messages = [
            {
                "role": "system",
                "content": self.system_message,
                "id": self.thread_id + "-system"
            },
            *self.state["messages"]
        ]

        tools = [action for action in self.state["copilotkit"]["actions"]
                 if action["function"]["name"] != self.crew_name]

        tools += [self.crew_tool_schema, CREW_EXIT_TOOL]

        response = await copilotkit_stream(
            completion(
                model=self.crew.chat_llm,
                messages=messages,
                tools=tools,
                parallel_tool_calls=False,
                stream=True
            )
        )

        message = cast(Any, response).choices[0]["message"]
        self.state["messages"].append(message)

        if message.get("tool_calls"):
            if message["tool_calls"][0]["function"]["name"] == self.crew_name:
                # run the crew
                crew_function = crew_chat_create_tool_function(self.crew, messages)
                args = json.loads(message["tool_calls"][0]["function"]["arguments"])
                result = crew_function(**args)
                self.state["messages"].append({
                    "role": "tool",
                    "content": result,
                    "tool_call_id": message["tool_calls"][0]["id"]
                })
            elif message["tool_calls"][0]["function"]["name"] == "crew_exit":
                await copilotkit_exit()
                self.state["messages"].append({
                    "role": "tool",
                    "content": "Crew exited",
                    "tool_call_id": message["tool_calls"][0]["id"]
                })

                response = await copilotkit_stream(
                    completion(
                        model=self.crew.chat_llm,
                        messages = [
                            {
                                "role": "system",
                                "content": "Indicate to the user that the crew has exited",
                                "id": self.thread_id + "-system"
                            },
                            *self.state["messages"]
                        ],
                        tools=tools,
                        parallel_tool_calls=False,
                        stream=True,
                        tool_choice="none"
                    )
                )
                message = cast(Any, response).choices[0]["message"]
                self.state["messages"].append(message)
