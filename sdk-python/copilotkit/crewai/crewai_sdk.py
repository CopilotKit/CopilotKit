"""
CrewAI integration for CopilotKit
"""

import uuid
import json
import asyncio
from typing_extensions import Any, Dict, List, Literal
from pydantic import BaseModel, Field
from litellm.types.utils import (
  ModelResponse,
  Choices,
  Message as LiteLLMMessage,
  ChatCompletionMessageToolCall,
  Function as LiteLLMFunction
)
from litellm.litellm_core_utils.streaming_handler import CustomStreamWrapper
from crewai.flow.flow import FlowState, Flow
from crewai.utilities.events.flow_events import (
    FlowEvent as CrewAIFlowEvent,
    FlowStartedEvent,
    MethodExecutionStartedEvent,
    MethodExecutionFinishedEvent,
    FlowFinishedEvent,
)
from crewai.utilities.events import crewai_event_bus as _crewai_event_bus

from copilotkit.types import Message
from copilotkit.logging import get_logger
from copilotkit.runloop import queue_put, get_context_execution
from copilotkit.protocol import (
    RuntimeEventTypes,
    RunStarted,
    RunFinished,
    RunError,
    NodeStarted,
    NodeFinished,
    agent_state_message,
    text_message_start,
    text_message_content,
    text_message_end,
    action_execution_start,
    action_execution_args,
    action_execution_end,
    meta_event,
    RuntimeMetaEventName,
    PredictStateConfig
)

logger = get_logger(__name__)

class CopilotKitProperties(BaseModel):
    """CopilotKit properties"""
    actions: List[Any] = Field(default_factory=list)

class CopilotKitState(FlowState):
    """CopilotKit state"""
    messages: List[Any] = Field(default_factory=list)
    copilotkit: CopilotKitProperties = Field(default_factory=CopilotKitProperties)

async def crewai_flow_async_runner(flow: Flow, inputs: Dict[str, Any]):
    """
    Runs a flow in a separate thread. Workaround since the flow will use
    asyncio.run().
    """

    async def crewai_flow_event_subscriber(flow: Any, event: CrewAIFlowEvent):
        if isinstance(event, FlowStartedEvent):
            await queue_put(RunStarted(
                type=RuntimeEventTypes.RUN_STARTED,
                state=flow.state
            ), priority=True)
        elif isinstance(event, MethodExecutionStartedEvent):
            await queue_put(NodeStarted(
                type=RuntimeEventTypes.NODE_STARTED,
                node_name=event.method_name,
                state=flow.state
            ), priority=True)
        elif isinstance(event, MethodExecutionFinishedEvent):
            await queue_put(NodeFinished(
                type=RuntimeEventTypes.NODE_FINISHED,
                node_name=event.method_name,
                state=flow.state
            ), priority=True)
        elif isinstance(event, FlowFinishedEvent):
            await queue_put(RunFinished(
                type=RuntimeEventTypes.RUN_FINISHED,
                state=flow.state
            ), priority=True)

    
    def _global_event_listener(_sender: Any, _event: CrewAIFlowEvent, **_kw):  # noqa: D401
        # Forward to the async handler inside the flow's loop
        loop = asyncio.get_running_loop()
        loop.call_soon(lambda: asyncio.create_task(crewai_flow_event_subscriber(flow, _event)))

    # Register for the specific event classes we care about to avoid noise
    for _ev_cls in (FlowStartedEvent, MethodExecutionStartedEvent, MethodExecutionFinishedEvent, FlowFinishedEvent):
            _crewai_event_bus.on(_ev_cls)(_global_event_listener)  # type: ignore

    try:
        await flow.kickoff_async(inputs=inputs)
    except Exception as e: # pylint: disable=broad-except
        await queue_put(RunError(
            type=RuntimeEventTypes.RUN_ERROR,
            error=e
        ))

async def copilotkit_emit_state(state: Any) -> Literal[True]:
    """
    Emits intermediate state to CopilotKit. 
    Useful if you have a longer running node and you want to update the user with the current state of the node.

    To install the CopilotKit SDK, run:

    ```bash
    pip install copilotkit[crewai]
    ```

    ### Examples

    ```python
    from copilotkit.crewai import copilotkit_emit_state

    for i in range(10):
        await some_long_running_operation(i)
        await copilotkit_emit_state({"progress": i})
    ```

    Parameters
    ----------
    state : Any
        The state to emit (Must be JSON serializable).

    Returns
    -------
    Awaitable[bool]
        Always return True.

    """
    execution = get_context_execution()

    state_as_dict = state.model_dump() if isinstance(state, BaseModel) else state
    state = {
        k: v for k, v in state_as_dict.items() if k not in ["messages", "copilotkit"]
    }

    await queue_put(
        agent_state_message(
            thread_id=execution["thread_id"],
            agent_name=execution["agent_name"],
            node_name=execution["node_name"],
            run_id=execution["run_id"],
            active=True,
            role="assistant",
            state=json.dumps(state_as_dict),
            running=True
        )
    )


    return True

async def copilotkit_emit_message(message: str) -> str:
    """
    Manually emits a message to CopilotKit. Useful in longer running nodes to update the user.
    Important: You still need to return the messages from the node.

    ### Examples

    ```python
    from copilotkit.crewai import copilotkit_emit_message

    message = "Step 1 of 10 complete"
    await copilotkit_emit_message(message)

    # Return the message from the node
    return {
        "messages": [AIMessage(content=message)]
    }
    ```

    Parameters
    ----------
    message : str
        The message to emit.

    Returns
    -------
    Awaitable[bool]
        Always return True.
    """
    message_id = str(uuid.uuid4())

    await queue_put(
        text_message_start(
            message_id=message_id,
            parent_message_id=None
        ),
        text_message_content(
            message_id=message_id,
            content=message
        ),
        text_message_end(
            message_id=message_id
        )
    )

    return message_id

async def copilotkit_emit_tool_call(*, name: str, args: Dict[str, Any]) -> str:
    """
    Manually emits a tool call to CopilotKit.

    ```python
    from copilotkit.crewai import copilotkit_emit_tool_call

    await copilotkit_emit_tool_call(name="SearchTool", args={"steps": 10})
    ```

    Parameters
    ----------
    name : str
        The name of the tool to emit.
    args : Dict[str, Any]
        The arguments to emit.

    Returns
    -------
    Awaitable[bool]
        Always return True.
    """
    message_id = str(uuid.uuid4())
    await queue_put(
        action_execution_start(
            action_execution_id=message_id,
            action_name=name,
            parent_message_id=message_id
        ),
        action_execution_args(
            action_execution_id=message_id,
            args=json.dumps(args)
        ),
        action_execution_end(
            action_execution_id=message_id
        )
    )

    return message_id


async def copilotkit_stream(response):
    """
    Stream litellm responses token by token to CopilotKit.

    ```python
    response = await copilotkit_stream(
        completion(
            model="openai/gpt-4o",
            messages=messages,
            tools=tools,
            stream=True # this must be set to True for streaming
        )
    )
    ```
    """
    if isinstance(response, ModelResponse):
        return _copilotkit_stream_response(response)
    if isinstance(response, CustomStreamWrapper):
        return await _copilotkit_stream_custom_stream_wrapper(response)
    raise ValueError("Invalid response type")


async def _copilotkit_stream_custom_stream_wrapper(response: CustomStreamWrapper):
    message_id: str = ""
    tool_call_id: str = ""
    content = ""
    created = 0
    model = ""
    system_fingerprint = ""
    finish_reason=None
    mode = None
    all_tool_calls = []

    for chunk in response:
        if message_id is None:
            message_id = chunk["id"]

        tool_calls = chunk["choices"][0]["delta"]["tool_calls"]
        finish_reason = chunk["choices"][0]["finish_reason"]
        created = chunk["created"]
        model = chunk["model"]
        system_fingerprint = chunk["system_fingerprint"]

        if mode == "text" and (tool_calls is not None or finish_reason is not None):
            # end the current text message
            await queue_put(
                text_message_end(
                    message_id=message_id
                )
            )
            
        elif mode == "tool" and (tool_calls is None or finish_reason is not None):
            # end the current tool call
            await queue_put(
                action_execution_end(
                    action_execution_id=tool_call_id
                )
            )

        if finish_reason is not None:
            break

        if mode != "text" and tool_calls is None:
            # start a new text message
            await queue_put(
                text_message_start(
                    message_id=message_id,
                    parent_message_id=None
                )
            )
        elif mode != "tool" and tool_calls is not None and tool_calls[0].id is not None:
            # start a new tool call
            tool_call_id = tool_calls[0].id

            await queue_put(
                action_execution_start(
                    action_execution_id=tool_call_id,
                    action_name=tool_calls[0].function["name"],
                    parent_message_id=message_id
                )
            )

            all_tool_calls.append(
                {
                    "id": tool_call_id,
                    "name": tool_calls[0].function["name"],
                    "arguments": "",
                }
            )

        mode = "tool" if tool_calls is not None else "text"

        if mode == "text":
            text_content = chunk["choices"][0]["delta"]["content"]
            if text_content is not None:
                content += text_content
                await queue_put(
                    text_message_content(
                        message_id=message_id,
                        content=text_content
                    )
                )

        elif mode == "tool":
            tool_arguments = tool_calls[0].function["arguments"]
            if tool_arguments is not None:
                await queue_put(
                    action_execution_args(
                        action_execution_id=tool_call_id,
                        args=tool_arguments
                    )
                )

                all_tool_calls[-1]["arguments"] += tool_arguments

    tool_calls = [
        ChatCompletionMessageToolCall(
            function=LiteLLMFunction(
                arguments=tool_call["arguments"],
                name=tool_call["name"]
            ),
            id=tool_call["id"],
            type="function"
        )
        for tool_call in all_tool_calls
    ]
    return ModelResponse(
        id=message_id,
        created=created,
        model=model,
        object='chat.completion',
        system_fingerprint=system_fingerprint,
        choices=[
            Choices(
                finish_reason=finish_reason,
                index=0,
                message=LiteLLMMessage(
                    content=content,
                    role='assistant',
                    tool_calls=tool_calls if len(tool_calls) > 0 else None,
                    function_call=None
                )
            )
        ]
    )

def _copilotkit_stream_response(response: ModelResponse):
    return response


async def copilotkit_exit() -> Literal[True]:
    """
    Exits the current agent after the run completes. Calling copilotkit_exit() will
    not immediately stop the agent. Instead, it signals to CopilotKit to stop the agent after
    the run completes.

    ### Examples

    ```python
    from copilotkit.crewai import copilotkit_exit

    def my_function():
        await copilotkit_exit()
        return state
    ```

    Returns
    -------
    Awaitable[bool]
        Always return True.
    """
    await queue_put(
        meta_event(
            name=RuntimeMetaEventName.EXIT,
            value=True
        )
    )
    return True


async def copilotkit_predict_state(
        config: Dict[str, PredictStateConfig]
    ) -> Literal[True]:
    """
    Stream tool calls as state to CopilotKit.

    To emit a tool call as streaming CrewAI state, pass the destination key in state,
    the tool name and optionally the tool argument. (If you don't pass the argument name,
    all arguments are emitted under the state key.)

    ```python
    from copilotkit.crewai import copilotkit_predict_state

    await copilotkit_predict_state(
        {
            "steps": {
                "tool_name": "SearchTool",
                "tool_argument": "steps",
            },
        }
    )
    ```

    Parameters
    ----------
    config : Dict[str, CopilotKitPredictStateConfig]
        The configuration to predict the state.

    Returns
    -------
    Awaitable[bool]
        Always return True.
    """

    await queue_put(
        meta_event(
            name=RuntimeMetaEventName.PREDICT_STATE,
            value=config
        )
    )
    return True


def copilotkit_messages_to_crewai_flow(messages: List[Message]) -> List[Any]:
    """
    Convert CopilotKit messages to CrewAI Flow messages
    """
    result = []
    processed_action_executions = set()

    for message in messages:
        message_id = message["id"]
        message_type = message.get("type")

        if message_type == "TextMessage":
            result.append({
                "id": message_id,
                "role": message.get("role"),
                "content": message.get("content")
            })
        elif message_type == "ActionExecutionMessage":
            # convert multiple tool calls to a single message
            original_message_id = message.get("parentMessageId", message_id)
            if original_message_id in processed_action_executions:
                continue

            processed_action_executions.add(original_message_id)

            all_tool_calls = []

            # Find all tool calls for this message
            for msg in messages:
                msg_id = msg["id"]
                if (msg.get("parentMessageId", None) == original_message_id or
                    msg_id == original_message_id):
                    all_tool_calls.append(msg)

            tool_calls = [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "arguments": json.dumps(t["arguments"]),
                    },
                    "id": t["id"],
                } for t in all_tool_calls]

            result.append(
                {
                    "id": original_message_id,
                    "role": "assistant",
                    "content": "",
                    "tool_calls": tool_calls
                }
            )

        elif message_type == "ResultMessage":
            result.append(
                {
                    "id": message_id,
                    "role": "tool",
                    "tool_call_id": message.get("actionExecutionId"),
                    "content": message.get("result"),
                }
            )

    return result

def crewai_flow_messages_to_copilotkit(messages: List[Dict]) -> List[Message]: # pylint: disable=too-many-branches
    """
    Convert CrewAI Flow messages to CopilotKit messages
    """
    result = []
    tool_call_names = {}

    message_ids = {
        id(m): m.get("id", str(uuid.uuid4())) for m in messages
    }

    for message in messages:
        if "content" in message and message.get("role") == "assistant":
            if message.get("tool_calls"):
                for tool_call in message["tool_calls"]:
                    tool_call_names[tool_call["id"]] = tool_call["function"]["name"]

    for message in messages:
        message_id = message_ids[id(message)]

        if message.get("role") == "tool":
            result.append({
                "actionExecutionId": message["tool_call_id"],
                "actionName": tool_call_names.get(message["tool_call_id"], message.get("name", "")),
                "result": message["content"],
                "id": message_id,
            })
        elif message.get("tool_calls"):
            for tool_call in message["tool_calls"]:
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
        elif message.get("content"):
            result.append({
                "role": message["role"],
                "content": message["content"],
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
