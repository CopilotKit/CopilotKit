"""CopilotKit SDK"""

from pprint import pformat
from typing import List, Callable, Union, Optional, TypedDict, Any, Coroutine
from .agent import Agent, AgentDict
from .action import Action, ActionDict, ActionResultDict
from .types import Message
from .exc import (
    ActionNotFoundException,
    AgentNotFoundException,
    ActionExecutionException,
    AgentExecutionException
)
from .logging import get_logger, bold


COPILOTKIT_SDK_VERSION = "0.1.22"

logger = get_logger(__name__)

class InfoDict(TypedDict):
    """Info dictionary"""
    sdkVersion: str
    actions: List[ActionDict]
    agents: List[AgentDict]

class CopilotKitSDKContext(TypedDict):
    """CopilotKit SDK Context"""
    properties: Any
    frontend_url: Optional[str]

class CopilotKitSDK:
    """CopilotKit SDK"""

    def __init__(
        self,
        *,
        actions: Optional[
            Union[
                List[Action],
                Callable[[CopilotKitSDKContext], List[Action]]
            ]
        ] = None,
        agents: Optional[
            Union[
                List[Agent],
                Callable[[CopilotKitSDKContext], List[Agent]]
            ]
        ] = None,
    ):
        self.agents = agents or []
        self.actions = actions or []

    def info(
        self,
        *,
        context: CopilotKitSDKContext
    ) -> InfoDict:
        """Returns information about available actions and agents"""

        actions = self.actions(context) if callable(self.actions) else self.actions
        agents = self.agents(context) if callable(self.agents) else self.agents

        actions_list = [action.dict_repr() for action in actions]
        agents_list = [agent.dict_repr() for agent in agents]

        logger.debug(bold("Handling info request:"))
        logger.debug("--------------------------")
        logger.debug(bold("Context:"))
        logger.debug(pformat(context))
        logger.debug(bold("Actions:"))
        logger.debug(pformat(actions_list))
        logger.debug(bold("Agents:"))
        logger.debug(pformat(agents_list))
        logger.debug("--------------------------")

        return {
            "actions": actions_list,
            "agents": agents_list,
            "sdkVersion": COPILOTKIT_SDK_VERSION
        }

    def _get_action(
        self,
        *,
        context: CopilotKitSDKContext,
        name: str,
    ) -> Action:
        """Get an action by name"""
        actions = self.actions(context) if callable(self.actions) else self.actions
        action = next((action for action in actions if action.name == name), None)
        if action is None:
            raise ActionNotFoundException(name)
        return action

    def execute_action(
            self,
            *,
            context: CopilotKitSDKContext,
            name: str,
            arguments: dict,
    ) -> Coroutine[Any, Any, ActionResultDict]:
        """Execute an action"""

        action = self._get_action(context=context, name=name)

        logger.info(bold("Handling execute action request:"))
        logger.info("--------------------------")
        logger.info(bold("Context:"))
        logger.info(pformat(context))
        logger.info(bold("Action:"))
        logger.info(pformat(action.dict_repr()))
        logger.info(bold("Arguments:"))
        logger.info(pformat(arguments))
        logger.info("--------------------------")

        try:
            result = action.execute(arguments=arguments)
            return result
        except Exception as error:
            raise ActionExecutionException(name, error) from error

    def execute_agent( # pylint: disable=too-many-arguments
        self,
        *,
        context: CopilotKitSDKContext,
        name: str,
        thread_id: str,
        node_name: str,
        state: dict,
        messages: List[Message],
        actions: List[ActionDict],
    ) -> Any:
        """Execute an agent"""
        agents = self.agents(context) if callable(self.agents) else self.agents
        agent = next((agent for agent in agents if agent.name == name), None)
        if agent is None:
            raise AgentNotFoundException(name)

        logger.info(bold("Handling execute agent request:"))
        logger.info("--------------------------")
        logger.info(bold("Context:"))
        logger.info(pformat(context))
        logger.info(bold("Agent:"))
        logger.info(pformat(agent.dict_repr()))
        logger.info(bold("Thread ID:"))
        logger.info(thread_id)
        logger.info(bold("Node Name:"))
        logger.info(node_name)
        logger.info(bold("State:"))
        logger.info(pformat(state))
        logger.info(bold("Messages:"))
        logger.info(pformat(messages))
        logger.info(bold("Actions:"))
        logger.info(pformat(actions))
        logger.info("--------------------------")

        try:
            return agent.execute(
                thread_id=thread_id,
                node_name=node_name,
                state=state,
                messages=messages,
                actions=actions,
            )
        except Exception as error:
            raise AgentExecutionException(name, error) from error
