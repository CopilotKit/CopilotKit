"""
CrewAI integration for CopilotKit
"""

import uuid
import threading
import queue
from enum import Enum
from typing_extensions import TypedDict, Any, Dict, NotRequired, Optional, List
from pydantic import BaseModel
from crewai.flow.flow import FlowState, Flow
from crewai.flow.flow_events import (
  Event as CrewAIFlowEvent,
  FlowStartedEvent as CrewAIFlowStartedEvent,
  MethodExecutionStartedEvent as CrewAIFlowMethodExecutionStartedEvent,
  MethodExecutionFinishedEvent as CrewAIFlowMethodExecutionFinishedEvent,
  FlowFinishedEvent as CrewAIFlowFinishedEvent,
)
from .types import Message
from .logging import get_logger

logger = get_logger(__name__)

class CopilotKitProperties(BaseModel):
    """CopilotKit properties"""
    actions: List[Any]

class CopilotKitState(FlowState):
    """CopilotKit state"""
    messages: List[Any]
    copilotkit: CopilotKitProperties

_THREAD_LOCAL = threading.local()

def _crewai_flow_thread_runner(flow: Flow, q: queue.Queue, inputs: Dict[str, Any]):
    """
    Runs a flow in a separate thread. Workaround since the flow will use
    asyncio.run().
    """

    _set_crewai_flow_event_queue(q)

    def crewai_flow_event_subscriber(_sender: Any, event: CrewAIFlowEvent):
        if isinstance(event, CrewAIFlowStartedEvent):
            _get_crewai_flow_event_queue().put(CopilotKitCrewAIFlowExecutionStarted(
                type= CopilotKitCrewAIFlowEventType.FLOW_EXECUTION_STARTED
            ))
        elif isinstance(event, CrewAIFlowMethodExecutionStartedEvent):
            _get_crewai_flow_event_queue().put(CopilotKitCrewAIFlowEventMethodExecutionStarted(
                type=CopilotKitCrewAIFlowEventType.METHOD_EXECUTION_STARTED,
                name=event.method_name
            ))
        elif isinstance(event, CrewAIFlowMethodExecutionFinishedEvent):
            _get_crewai_flow_event_queue().put(CopilotKitCrewAIFlowEventMethodExecutionFinished(
                type=CopilotKitCrewAIFlowEventType.METHOD_EXECUTION_FINISHED,
                name=event.method_name
            ))
        elif isinstance(event, CrewAIFlowFinishedEvent):
            _get_crewai_flow_event_queue().put(CopilotKitCrewAIFlowExecutionFinished(
                type=CopilotKitCrewAIFlowEventType.FLOW_EXECUTION_FINISHED
            ))

    flow.event_emitter.connect(crewai_flow_event_subscriber)

    try:
        print("Kicking off flow", flush=True)
        print("Inputs", inputs, flush=True)
        flow.kickoff(inputs=inputs)
    except Exception as e: # pylint: disable=broad-except
        _get_crewai_flow_event_queue().put(CopilotKitCrewAIFlowEventExecutionError(
            type=CopilotKitCrewAIFlowEventType.FLOW_EXECUTION_ERROR,
            error=str(e)
        ))

def _set_crewai_flow_event_queue(q: queue.Queue):
    """
    Store a queue in this thread's local storage.
    """
    _THREAD_LOCAL.crewai_flow_event_queue = q

def _get_crewai_flow_event_queue() -> queue.Queue:
    """
    Retrieve the queue from this thread's local storage (or None if missing).
    """
    q = getattr(_THREAD_LOCAL, "crewai_flow_event_queue", None)
    if q is None:
        raise RuntimeError("No thread-local flow event queue is set in this thread!")
    return q

class CopilotKitCrewAIFlowEventType(Enum):
    """
    CopilotKit CrewAI Flow Event Type
    """
    EMIT_STATE = "copilotkit_emit_state"
    EMIT_MESSAGE = "copilotkit_emit_message"
    EMIT_TOOL_CALL = "copilotkit_emit_tool_call"
    EXIT = "copilotkit_exit"
    PREDICT_STATE = "copilotkit_predict_state"
    FLOW_EXECUTION_STARTED = "copilotkit_flow_execution_started"
    FLOW_EXECUTION_FINISHED = "copilotkit_flow_execution_finished"
    METHOD_EXECUTION_STARTED = "copilotkit_method_execution_started"
    METHOD_EXECUTION_FINISHED = "copilotkit_method_execution_finished"
    FLOW_EXECUTION_ERROR = "copilotkit_flow_execution_error"

class CopilotKitCrewAIFlowEvent(TypedDict):
    """
    CopilotKit CrewAI Flow Event
    """
    type: CopilotKitCrewAIFlowEventType

class CopilotKitCrewAIFlowEventEmitState(TypedDict):
    """
    CopilotKit CrewAI Flow Event Emit State
    """
    type: CopilotKitCrewAIFlowEventType.EMIT_STATE
    state: Any

class CopilotKitCrewAIFlowEventEmitMessage(TypedDict):
    """
    CopilotKit CrewAI Flow Event Emit Message
    """
    type: CopilotKitCrewAIFlowEventType.EMIT_MESSAGE
    message_id: str
    message: str

class CopilotKitCrewAIFlowEventEmitToolCall(TypedDict):
    """
    CopilotKit CrewAI Flow Event Emit Tool Call
    """
    type: CopilotKitCrewAIFlowEventType.EMIT_TOOL_CALL
    message_id: str
    name: str
    args: Dict[str, Any]

class CopilotKitCrewAIFlowEventExit(TypedDict):
    """
    CopilotKit CrewAI Flow Event Exit
    """
    type: CopilotKitCrewAIFlowEventType.EXIT

class CopilotKitCrewAIFlowEventPredictState(TypedDict):
    """
    CopilotKit CrewAI Flow Event Predict State
    """
    type: CopilotKitCrewAIFlowEventType.PREDICT_STATE
    key: str
    tool_name: str
    tool_argument: NotRequired[str]

class CopilotKitCrewAIFlowExecutionStarted(TypedDict):
    """
    CopilotKit CrewAI Flow Event Method Execution Started
    """
    type: CopilotKitCrewAIFlowEventType.FLOW_EXECUTION_STARTED

class CopilotKitCrewAIFlowExecutionFinished(TypedDict):
    """
    CopilotKit CrewAI Flow Event Method Execution Finished
    """
    type: CopilotKitCrewAIFlowEventType.FLOW_EXECUTION_FINISHED

class CopilotKitCrewAIFlowEventMethodExecutionStarted(TypedDict):
    """
    CopilotKit CrewAI Flow Event Method Execution Started
    """
    type: CopilotKitCrewAIFlowEventType.METHOD_EXECUTION_STARTED

class CopilotKitCrewAIFlowEventMethodExecutionFinished(TypedDict):
    """
    CopilotKit CrewAI Flow Event Method Execution Finished
    """
    type: CopilotKitCrewAIFlowEventType.METHOD_EXECUTION_FINISHED
    name: str

class CopilotKitCrewAIFlowEventExecutionError(TypedDict):
    """
    CopilotKit CrewAI Flow Event Execution Error
    """
    type: CopilotKitCrewAIFlowEventType.FLOW_EXECUTION_ERROR
    error: str

# We are leaving all these functions as async- in the future when we
# switch from a separate thread to an async queue, user code will
# still work

async def copilotkit_emit_state(state: Any) -> True:
    """
    Emit a state event
    """
    _get_crewai_flow_event_queue().put(
        CopilotKitCrewAIFlowEventEmitState(
            type=CopilotKitCrewAIFlowEventType.EMIT_STATE,
            state=state
        )
    )

    return True

async def copilotkit_emit_message(*, message: str) -> True:
    """
    Manually emit a message to CopilotKit.
    """
    message_id = str(uuid.uuid4())

    _get_crewai_flow_event_queue().put(
        CopilotKitCrewAIFlowEventEmitMessage(
            type=CopilotKitCrewAIFlowEventType.EMIT_MESSAGE,
            message_id=message_id,
            message=message
        )
    )

    return message_id

async def copilotkit_emit_tool_call(*, name: str, args: Dict[str, Any]):
    """
    Manually emit a tool call to CopilotKit.
    """
    message_id = str(uuid.uuid4())
    _get_crewai_flow_event_queue().put(
        CopilotKitCrewAIFlowEventEmitToolCall(
            type=CopilotKitCrewAIFlowEventType.EMIT_TOOL_CALL,
            message_id=message_id,
            name=name,
            args=args
        )
    )
    return message_id

async def copilotkit_exit():
    """
    Exit the agent
    """
    _get_crewai_flow_event_queue().put(CopilotKitCrewAIFlowEventExit())

async def copilotkit_predict_state(
        *,
        key: str,
        tool_name: str,
        tool_argument: Optional[str] = None
    ):
    """
    Predict the next state
    """
    _get_crewai_flow_event_queue().put(CopilotKitCrewAIFlowEventPredictState(
        type=CopilotKitCrewAIFlowEventType.PREDICT_STATE,
        key=key,
        tool_name=tool_name,
        tool_argument=tool_argument
    ))


def copilotkit_message_to_crewai_crew(message: Any) -> Any:
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

def copilotkit_messages_to_crewai_flow(messages: List[Message]) -> List[Any]:
    """
    Convert CopilotKit messages to CrewAI Flow messages
    """
    result = []
    processed_action_executions = set()

    for message in messages:
        message_id = message["id"]

        if message["type"] == "TextMessage":
            result.append({
                "id": message_id,
                "role": message["role"],
                "content": message["content"]
            })
        elif message["type"] == "ActionExecutionMessage":
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
                    "name": t["name"],
                    "args": t["arguments"],
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

        elif message["type"] == "ResultMessage":
            result.append(
                {
                    "id": message_id,
                    "role": "tool",
                    "tool_call_id": message["actionExecutionId"],
                    "content": message["result"],
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
            for tool_call in message.get("tool_calls", []):
                tool_call_names[tool_call["id"]] = tool_call["name"]

    for message in messages:
        message_id = message_ids[id(message)]

        if message.get("tool_calls"):
            for tool_call in message["tool_calls"]:
                result.append({
                    "id": tool_call["id"],
                    "name": tool_call["name"],
                    "arguments": tool_call["args"],
                    "parentMessageId": message_id,
                })
        elif message.get("content"):
            result.append({
                "role": message["role"],
                "content": message["content"],
                "id": message_id,
            })

        elif message.get("role") == "tool":
            result.append({
                "actionExecutionId": message["tool_call_id"],
                "actionName": tool_call_names.get(message["tool_call_id"], message.get("name", "")),
                "result": message["content"],
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
        if msg.get("arguments"):
            msg_id = message_ids[id(msg)]
            if msg_id in results_dict:
                reordered_result.append(results_dict[msg_id])
            else:
                logger.warning("Tool call result message not found for id: %s", msg_id)

    return reordered_result
