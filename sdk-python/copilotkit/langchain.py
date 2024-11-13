"""
LangChain specific utilities for CopilotKit
"""

import uuid
import json
from typing import List, Optional, Any, Union, Dict, Callable

from langchain_core.messages import (
    HumanMessage,
    SystemMessage,
    BaseMessage,
    AIMessage,
    ToolMessage
)
from langchain_core.runnables import RunnableConfig, RunnableGenerator

from .types import Message, IntermediateStateConfig

def copilotkit_messages_to_langchain(
        use_function_call: bool = False
    ) -> Callable[[List[Message]], List[BaseMessage]]:
    """
    Convert CopilotKit messages to LangChain messages
    """
    def _copilotkit_messages_to_langchain(messages: List[Message]) -> List[BaseMessage]:
        result = []
        for message in messages:
            if "content" in message:
                if message["role"] == "user":
                    result.append(HumanMessage(content=message["content"], id=message["id"]))
                elif message["role"] == "system":
                    result.append(SystemMessage(content=message["content"], id=message["id"]))
                elif message["role"] == "assistant":
                    result.append(AIMessage(content=message["content"], id=message["id"]))
            elif "arguments" in message:
                tool_call = {
                    "name": message["name"],
                    "args": message["arguments"],
                    "id": message["id"],
                }
                additional_kwargs = {
                    'function_call':{
                        'name': message["name"],
                        'arguments': json.dumps(message["arguments"]),
                    }
                }
                if not use_function_call:
                    ai_message = AIMessage(
                        id=message["id"],
                        content="",
                        tool_calls=[tool_call]
                    )
                else:
                    ai_message = AIMessage(
                        id=message["id"],
                        content="",
                        additional_kwargs=additional_kwargs 
                    )
                result.append(ai_message)

            elif "actionExecutionId" in message:
                result.append(ToolMessage(
                    id=message["id"],
                    content=message["result"],
                    name=message["actionName"],
                    tool_call_id=message["actionExecutionId"]
                ))
        return result

    return _copilotkit_messages_to_langchain

def copilotkit_customize_config(
        base_config: Optional[RunnableConfig] = None,
        *,
        emit_tool_calls: Optional[Union[bool, str, List[str]]] = None,
        emit_messages: Optional[bool] = None,
        emit_all: Optional[bool] = None,
        emit_intermediate_state: Optional[List[IntermediateStateConfig]] = None
    ) -> RunnableConfig:
    """
    Configure for LangChain for use in CopilotKit
    """
    metadata = base_config.get("metadata", {}) if base_config else {}

    if emit_all is True:
        metadata["copilotkit:emit-tool-calls"] = True
        metadata["copilotkit:emit-messages"] = True
    else:
        if emit_tool_calls is not None:
            metadata["copilotkit:emit-tool-calls"] = emit_tool_calls
        if emit_messages is not None:
            metadata["copilotkit:emit-messages"] = emit_messages

    if emit_intermediate_state:
        metadata["copilotkit:emit-intermediate-state"] = emit_intermediate_state

    base_config = base_config or {}

    return {
        **base_config,
        "metadata": metadata
    }

async def _exit_copilotkit_generator(state): # pylint: disable=unused-argument
    yield "Exit"


async def copilotkit_exit(config: RunnableConfig):
    """
    Exit CopilotKit
    """
    # For some reason, we need to use this workaround to get custom events to work
    # dispatch_custom_event and friends don't seem to do anything
    gen = RunnableGenerator(_exit_copilotkit_generator).with_config(
        metadata={
            "copilotkit:exit": True
        },
        callbacks=config.get(
            "callbacks", []
        ),
    )
    async for _message in gen.astream({}):
        pass

    return True

def _emit_copilotkit_state_generator(state):
    async def emit_state(_state: Any): # pylint: disable=unused-argument
        yield state
    return emit_state


async def copilotkit_emit_state(config: RunnableConfig, state: Any):
    """
    Emit CopilotKit state
    """
    gen = RunnableGenerator(_emit_copilotkit_state_generator(state)).with_config(
        metadata={
            "copilotkit:force-emit-intermediate-state": True
        },
        callbacks=config.get(
            "callbacks", []
        ),
    )
    async for _message in gen.astream({}):
        pass

    return True

def _emit_copilotkit_message_generator(message: str):
    async def emit_message(_message: Any): # pylint: disable=unused-argument
        yield message
    return emit_message

async def copilotkit_emit_message(config: RunnableConfig, message: str):
    """
    Emit CopilotKit message
    """
    gen = RunnableGenerator(_emit_copilotkit_message_generator(message)).with_config(
        metadata={
            "copilotkit:manually-emit-message": True
        },
        callbacks=config.get(
            "callbacks", []
        ),
    )
    async for _message in gen.astream({}):
        pass

    return True

def _emit_copilotkit_tool_call_generator(name: str, args: Dict[str, Any]):
    async def emit_tool_call(_tool_call: Any): # pylint: disable=unused-argument
        yield {
            "name": name,
            "args": args,
            "id": str(uuid.uuid4())
        }
    return emit_tool_call

async def copilotkit_emit_tool_call(config: RunnableConfig, *, name: str, args: Dict[str, Any]):
    """
    Emit CopilotKit tool call
    """
    gen = RunnableGenerator(_emit_copilotkit_tool_call_generator(name, args)).with_config(
        metadata={
            "copilotkit:manually-emit-tool-call": True
        },
        callbacks=config.get(
            "callbacks", []
        ),
    )
    async for _message in gen.astream({}):
        pass

    return True
