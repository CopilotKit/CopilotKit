"""
LlamaIndex Agent
"""

import uuid
from typing_extensions import Callable, Optional, NotRequired, TypedDict, List, Any
from llama_index.core.workflow import Workflow
from copilotkit.agent import Agent
from copilotkit.types import Message
from copilotkit.action import ActionDict
from copilotkit.llamaindex.llamaindex_sdk import CopilotKitEvents
from copilotkit.protocol import emit_runtime_events

class CopilotKitConfig(TypedDict):
    """
    CopilotKit config for CrewAIAgent

    This is used for advanced cases where you want to customize how CopilotKit interacts with
    LlamaIndex.

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

class LlamaIndexAgent(Agent):
    """
    LlamaIndex Agent
    """

    def __init__(
            self,
            *,
            name: str,
            description: Optional[str] = None,
            workflow: Workflow,
            copilotkit_config: Optional[CopilotKitConfig] = None,
        ):
        super().__init__(
            name=name,
            description=description,
        )

        self.workflow = workflow
        self.copilotkit_config = copilotkit_config or {}


    def execute( # pylint: disable=too-many-arguments
        self,
        *,
        state: dict,
        thread_id: str,
        messages: List[Message],
        actions: Optional[List[ActionDict]] = None,
        **kwargs,
    ):
        """
        Execute the agent
        """
        return self._execute_async(
            state=state,
            thread_id=thread_id,
            messages=messages,
            actions=actions,
            **kwargs
        )
    
    async def _execute_async(
            self,
            *,
            state: dict,
            thread_id: Optional[str] = None,
            messages: List[Message],
            actions: Optional[List[ActionDict]] = None,
            **kwargs
        ):
        if thread_id is None:
            raise ValueError("Thread ID is required")

        run_id = str(uuid.uuid4())

        merge_state = self.copilotkit_config.get("merge_state", llamaindex_default_merge_state)

        llamaindex_messages = copilotkit_messages_to_llamaindex(messages)

        state = merge_state(
            state=state,
            messages=llamaindex_messages,
            actions=actions or [],
            agent_name=self.name,
            workflow=self.workflow
        )

        handler = self.workflow.run()
        async for event in handler.stream_events():
            if isinstance(event, CopilotKitEvents):
                if event.events:
                    yield emit_runtime_events(*event.events)

    async def get_state(self, *, thread_id: str):
        return dict()

    def dict_repr(self):
        super_repr = super().dict_repr()
        return {
            **super_repr,
            'type': 'llamaindex'
        }

def llamaindex_default_merge_state( # pylint: disable=unused-argument, too-many-arguments
        *,
        state: dict,
        workflow: Workflow,
        messages: List[Any],
        actions: List[Any],
        agent_name: str,
    ):
    """Default merge state for CrewAI"""
    if len(messages) > 0:
        if "role" in messages[0] and messages[0]["role"] == "system":
            messages = messages[1:]

    # TODO: add actions to the state
    # actions = [{
    #     "type": "function",
    #     "function": {
    #         **action,
    #     }
    # } for action in actions]

    new_state = {
        **state,
        "messages": messages,
        # "copilotkit": {
        #     "actions": actions
        # }
    }

    return new_state
