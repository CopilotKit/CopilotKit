"""
LlamaIndex Agent
"""

from typing_extensions import Callable, Optional, NotRequired, TypedDict, List
from llama_index.core.agent.workflow import AgentWorkflow
from copilotkit.agent import Agent
from copilotkit.types import Message
from copilotkit.action import ActionDict


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
            workflow: AgentWorkflow,
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
            thread_id: str,
            messages: List[Message],
            actions: Optional[List[ActionDict]] = None,
            **kwargs
        ):
        handler = self.workflow.run(user_msg="What's the weather like in San Francisco?")
        async for event in handler.stream_events():
            print(event, flush=True)


    def dict_repr(self):
        super_repr = super().dict_repr()
        return {
            **super_repr,
            'type': 'llamaindex'
        }