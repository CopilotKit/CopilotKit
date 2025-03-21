"""
CopilotKit SDK for LlamaIndex
"""

import uuid
import json
from typing import List, AsyncGenerator, Optional, Literal, cast
from llama_index.core.base.llms.types import (
  CompletionResponse,
  CompletionResponseAsyncGen,
  ChatResponse,
  ChatResponseAsyncGen,
  MessageRole
)
from llama_index.core.workflow import (
    Event,
    Context,
)
from llama_index.core.llms import ChatMessage
from copilotkit.protocol import (
    text_message_start,
    text_message_content,
    text_message_end,
    action_execution_start,
    action_execution_end,
    action_execution_args,
    RuntimeProtocolEvent
)
from copilotkit.types import Message
from copilotkit.utils import get_logger

logger = get_logger(__name__)

class CopilotKitEvents(Event):
    """
    CopilotKit event
    """
    events: List[RuntimeProtocolEvent]


async def copilotkit_stream(
        context: Context,
        response: CompletionResponseAsyncGen | CompletionResponse
    ):
    """
    Stream LlamaIndex responses token by token to CopilotKit.

    ```python
    llm = OpenAI(model="gpt-4o-mini")
    response = await copilotkit_stream(
        llm.astream_complete(
            input_message
        )
    )
    ```
    """
    # 1) llm.complete()
    if isinstance(response, CompletionResponse):
        return _copilotkit_stream_completion_response(
            context=context,
            response=response
        )
    # 2) llm.chat_with_tools()
    if isinstance(response, ChatResponse):
        return _copilotkit_stream_chat_response(
            context=context,
            response=response
        )
    # 3) llm.astream_complete() or llm.astream_chat_with_tools()
    if isinstance(response, AsyncGenerator):
        return await _copilotkit_stream_completion_response_async_gen(
            context=context,
            response=response
        )
    raise ValueError("Invalid response type")

def _copilotkit_stream_completion_response(context: Context, response: CompletionResponse):
    message_id = str(uuid.uuid4())

    if response.text:
        context.write_event_to_stream(
            CopilotKitEvents(
                events=[
                    text_message_start(message_id=message_id),
                    text_message_content(message_id=message_id, content=response.text),
                    text_message_end(message_id=message_id),
                ]
            )
        )
    return response

def _copilotkit_stream_chat_response(context: Context, response: ChatResponse):
    if response.message:
        message_id = str(uuid.uuid4())
        for ix, block in enumerate(response.message.blocks or []):
            if block.block_type == "text":
                current_message_id = message_id if ix == 0 else str(uuid.uuid4())
                context.write_event_to_stream(
                    CopilotKitEvents(
                        events=[
                            text_message_start(message_id=current_message_id),
                            text_message_content(message_id=current_message_id, content=block.text),
                            text_message_end(message_id=current_message_id),
                        ]
                    )
                )
        for tool_call in response.message.additional_kwargs.get("tool_calls", []):
            action_execution_id = tool_call.id
            action_name = tool_call.function.name
            action_args = tool_call.args

            context.write_event_to_stream(
                CopilotKitEvents(
                    events=[
                        action_execution_start(
                            action_execution_id=action_execution_id,
                            action_name=action_name,
                            parent_message_id=message_id
                        ),
                        action_execution_args(
                            action_execution_id=action_execution_id,
                            args=action_args
                        ),
                        action_execution_end(
                            action_execution_id=action_execution_id
                        ),
                    ]
                )
            )
   
    return response


async def _copilotkit_stream_completion_response_async_gen(
        context: Context,
        response: CompletionResponseAsyncGen | ChatResponseAsyncGen
    ):

    message_id = str(uuid.uuid4())

    current_message_type : Optional[Literal["text", "tool"]] = None
    current_tool_call_id: Optional[str] = None
    chunk = None

    async for chunk in response:
        events: List[RuntimeProtocolEvent] = []
        # 1) llm.astream_chat_with_tools()
        if isinstance(chunk, ChatResponse):

            if chunk.delta:
                if current_message_type == "tool":
                    events.append(
                        action_execution_end(
                            action_execution_id=cast(str, current_tool_call_id),
                        )
                    )
                if current_message_type != "text":
                    events.append(
                        text_message_start(message_id=message_id)
                    )

                current_message_type = "text"

                events.append(
                    text_message_content(message_id=message_id, content=chunk.delta)
                )

            elif tool_call := (chunk.message.additional_kwargs.get("tool_calls") or [None])[0]:
                tool_call_id = tool_call.id

                if (current_message_type == "tool" and
                    current_tool_call_id is not None and
                    current_tool_call_id != tool_call_id):
                    events.append(
                        action_execution_end(
                            action_execution_id=current_tool_call_id
                        )
                    )
                    current_message_type = None

                current_tool_call_id = tool_call_id

                if current_message_type != "tool":
                    events.append(
                        action_execution_start(
                            action_execution_id=tool_call_id,
                            action_name=tool_call.function.name,
                            parent_message_id=message_id
                        )
                    )
                    current_message_type = "tool"

                if tool_call.function.arguments:
                    events.append(
                        action_execution_args(
                            action_execution_id=tool_call_id,
                            args=tool_call.function.arguments
                        )
                    )
        # 2) llm.astream_complete()
        elif isinstance(chunk, CompletionResponse):

            if chunk.delta:
                if current_message_type != "text":
                    events.append(
                        text_message_start(message_id=message_id)
                    )
                    current_message_type = "text"

                events.append(
                    text_message_content(message_id=message_id, content=chunk.delta)
                )

        # when this chunk resulted in new events, write them to the stream
        if events:
            context.write_event_to_stream(CopilotKitEvents(events=events))


    if current_message_type == "text":
        context.write_event_to_stream(
            CopilotKitEvents(
                events=[
                    text_message_end(message_id=message_id)
                ]
            )
        )
    elif current_message_type == "tool" and current_tool_call_id is not None:
        context.write_event_to_stream(
            CopilotKitEvents(
                events=[
                    action_execution_end(action_execution_id=current_tool_call_id)
                ]
            )
        )

    return chunk


def llamaindex_messages_to_copilotkit(messages: List[ChatMessage]) -> List[Message]: # pylint: disable=too-many-branches
    """
    Convert CrewAI Flow messages to CopilotKit messages
    """
    result = []
    tool_call_names = {}

    message_ids = {
        id(m): str(uuid.uuid4()) for m in messages
    }

    for message in messages:
        if message.role == MessageRole.ASSISTANT:
            if message_tool_calls := message.additional_kwargs.get("tool_calls"):
                for tool_call in message_tool_calls:
                    tool_call_names[tool_call["id"]] = tool_call["function"]["name"]

    for message in messages:
        message_id = message_ids[id(message)]

        if message.role == MessageRole.TOOL:
            result.append({
                "actionExecutionId": message.additional_kwargs["tool_call_id"],
                "actionName": tool_call_names.get(
                    message.additional_kwargs["tool_call_id"],
                      message.additional_kwargs.get("name")
                ),
                "result": message.content,
                "id": message_id,
            })
        elif message_tool_calls := message.additional_kwargs.get("tool_calls"):
            for tool_call in message_tool_calls:
                if tool_call.get("function"):
                    result.append({
                        "id": tool_call["id"],
                        "name": tool_call["function"]["name"],
                        "arguments": json.loads(tool_call["function"]["arguments"]),
                        "parentMessageId": message_id,
                    })
                else:
                    result.append({
                        "id": tool_call["id"],
                        "name": tool_call["name"],
                        "arguments": tool_call["arguments"],
                        "parentMessageId": message_id,
                    })
        elif message.content:
            result.append({
                "role": message.role,
                "content": message.content,
                "id": message_id,
            })

    # Create a dictionary to map message ids to their corresponding messages
    results_dict = {msg["actionExecutionId"]: msg for msg in result if "actionExecutionId" in msg}


    # since we are splitting multiple tool calls into multiple messages,
    # we need to reorder the corresponding result messages to be after the tool call
    reordered_result = []

    for msg in result:

        # add all messages that are not tool call results
        if not "actionExecutionId" in msg:
            reordered_result.append(msg)

        # if the message is a tool call, also add the corresponding result message
        # immediately after the tool call
        if msg.get("name"):
            msg_id = msg["id"]
            if msg_id in results_dict:
                reordered_result.append(results_dict[msg_id])
            else:
                logger.warning("Tool call result message not found for id: %s", msg_id)

    return reordered_result
