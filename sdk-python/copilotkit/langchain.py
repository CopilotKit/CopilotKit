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
from langchain_core.runnables import RunnableConfig
from langchain_core.callbacks.manager import adispatch_custom_event

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


async def copilotkit_exit(config: RunnableConfig):
    """
    Exit CopilotKit
    """

    await adispatch_custom_event(
        "copilotkit_exit",
        {},
        config=config,
    )

    return True

async def copilotkit_emit_state(config: RunnableConfig, state: Any):
    """
    Emit CopilotKit state
    """

    await adispatch_custom_event(
        "copilotkit_manually_emit_intermediate_state",
        state,
        config=config,
    )

    return True

async def copilotkit_emit_message(config: RunnableConfig, message: str):
    """
    Emit CopilotKit message
    """
    await adispatch_custom_event(
        "copilotkit_manually_emit_message",
        {
            "message": message,
            "message_id": str(uuid.uuid4()),
            "role": "assistant"
        },
        config=config,
    )

    return True


async def copilotkit_emit_tool_call(config: RunnableConfig, *, name: str, args: Dict[str, Any]):
    """
    Emit CopilotKit tool call
    """

    await adispatch_custom_event(
        "copilotkit_manually_emit_tool_call",
        {
            "name": name,
            "args": args,
            "id": str(uuid.uuid4())
        },
        config=config,
    )

    return True
