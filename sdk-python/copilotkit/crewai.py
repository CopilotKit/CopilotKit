"""
CrewAI integration for CopilotKit
"""

import json
import uuid
import contextvars
from enum import Enum
from typing_extensions import TypedDict, Any, Dict, NotRequired, Optional, List
from pydantic import BaseModel
from crewai.flow.flow import FlowState
from .types import Message

class CopilotKitProperties(BaseModel):
    """CopilotKit properties"""
    actions: List[Any]

class CopilotKitState(FlowState):
    """CopilotKit state"""
    messages: List[Any]
    copilotkit: CopilotKitProperties

CREWAI_FLOW_EVENT_QUEUE = contextvars.ContextVar("CREWAI_EVENT_QUEUE", default=None)

class CopilotKitCrewAIFlowEventType(Enum):
    """
    CopilotKit CrewAI Flow Event Type
    """
    EMIT_STATE = "copilotkit_emit_state"
    EMIT_MESSAGE = "copilotkit_emit_message"
    EMIT_TOOL_CALL = "copilotkit_emit_tool_call"
    EXIT = "copilotkit_exit"
    PREDICT_STATE = "copilotkit_predict_state"

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


async def copilotkit_emit_state(state: Any) -> True:
    """
    Emit a state event
    """
    queue = CREWAI_FLOW_EVENT_QUEUE.get()
    if queue is None:
        raise ValueError("No event queue found")

    await queue.put(
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
    queue = CREWAI_FLOW_EVENT_QUEUE.get()
    if queue is None:
        raise ValueError("No event queue found")

    message_id = str(uuid.uuid4())
    await queue.put(
        CopilotKitCrewAIFlowEventEmitMessage(
            type=CopilotKitCrewAIFlowEventType.EMIT_MESSAGE,
            message_id=message_id,
            message=message
        )
    )

async def copilotkit_emit_tool_call(*, name: str, args: Dict[str, Any]):
    """
    Manually emit a tool call to CopilotKit.
    """
    queue = CREWAI_FLOW_EVENT_QUEUE.get()
    if queue is None:
        raise ValueError("No event queue found")

    message_id = str(uuid.uuid4())
    await queue.put(
        CopilotKitCrewAIFlowEventEmitToolCall(
            type=CopilotKitCrewAIFlowEventType.EMIT_TOOL_CALL,
            message_id=message_id,
            name=name,
            args=args
        )
    )

async def copilotkit_exit():
    """
    Exit the agent
    """
    queue = CREWAI_FLOW_EVENT_QUEUE.get()
    if queue is None:
        raise ValueError("No event queue found")

    await queue.put(CopilotKitCrewAIFlowEventExit())

async def copilotkit_predict_state(
        *,
        key: str,
        tool_name: str,
        tool_argument: Optional[str] = None
    ):
    """
    Predict the next state
    """
    queue = CREWAI_FLOW_EVENT_QUEUE.get()
    if queue is None:
        raise ValueError("No event queue found")

    await queue.put(CopilotKitCrewAIFlowEventPredictState(
        type=CopilotKitCrewAIFlowEventType.PREDICT_STATE,
        key=key,
        tool_name=tool_name,
        tool_argument=tool_argument
    ))



def copilotkit_execute_action(name: str, args: dict) -> str:
    """
    Execute an action
    """
    # Flow will need a different implementation
    return json.dumps({
        "__copilotkit_execute_action__": {
            "name": name,
            "args": args
        }
    })


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
        if message["type"] == "TextMessage":
            result.append({
                "id": message["id"],
                "role": message["role"],
                "content": message["content"]
            })
        elif message["type"] == "ActionExecutionMessage":
            
            # convert multiple tool calls to a single message
            message_id = message.get("parentMessageId", message["id"])
            if message_id in processed_action_executions:
                continue

            processed_action_executions.add(message_id)

            all_tool_calls = []

            # Find all tool calls for this message
            for msg in messages:
                if msg.get("parentMessageId", None) == message_id or msg["id"] == message_id:
                    all_tool_calls.append(msg)

            tool_calls = [
                {
                    "name": t["name"],
                    "args": t["arguments"],
                    "id": t["id"],
                } for t in all_tool_calls]

            result.append(
                {
                    "id": message_id,
                    "role": "assistant",
                    "content": "",
                    "tool_calls": tool_calls
                }
            )

        elif message["type"] == "ResultMessage":
            result.append(
                {
                    "id": message["id"],
                    "role": "tool",
                    "tool_call_id": message["actionExecutionId"],
                    "content": message["result"],
                }
            )

    return result