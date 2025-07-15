from typing import Dict, Any, List, Optional, Union, AsyncGenerator
from enum import Enum
from ag_ui_langgraph import LangGraphAgent
from ag_ui.core import (
    EventType,
    CustomEvent,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    ToolCallStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    StateSnapshotEvent,
)
from langgraph.graph.state import CompiledStateGraph
from langchain_core.runnables import RunnableConfig
from langchain.schema import BaseMessage


class CustomEventNames(Enum):
    """Custom event names for CopilotKit"""
    ManuallyEmitMessage = "copilotkit_manually_emit_message"
    ManuallyEmitToolCall = "copilotkit_manually_emit_tool_call"
    ManuallyEmitState = "copilotkit_manually_emit_intermediate_state"


class LangGraphEventTypes(Enum):
    """LangGraph event types"""
    OnChatModelStream = "on_chat_model_stream"
    OnCustomEvent = "on_custom_event"


class PredictStateTool:
    def __init__(self, tool: str, state_key: str, tool_argument: str):
        self.tool = tool
        self.state_key = state_key
        self.tool_argument = tool_argument


State = Dict[str, Any]
SchemaKeys = Dict[str, List[str]]
TextMessageEvents = Union[TextMessageStartEvent, TextMessageContentEvent, TextMessageEndEvent]
ToolCallEvents = Union[ToolCallStartEvent, ToolCallArgsEvent, ToolCallEndEvent]


class LangGraphAGUIAgent(LangGraphAgent):
    def __init__(self, *, name: str, graph: CompiledStateGraph, description: Optional[str] = None, config: Union[Optional[RunnableConfig], dict] = None):
        super().__init__(name=name, graph=graph, description=description, config=config)
        self.constant_schema_keys = self.constant_schema_keys + ["copilotkit"]

    def _dispatch_event(self, event) -> str:
        """Override the dispatch event method to handle custom CopilotKit events and filtering"""
        
        if event.type == EventType.CUSTOM:
            custom_event = event

            if custom_event.name == CustomEventNames.ManuallyEmitMessage.value:
                # Emit the message events
                super()._dispatch_event(
                    TextMessageStartEvent(
                        type=EventType.TEXT_MESSAGE_START,
                        role="assistant",
                        message_id=custom_event.value["message_id"],
                        raw_event=event,
                    )
                )
                super()._dispatch_event(
                    TextMessageContentEvent(
                        type=EventType.TEXT_MESSAGE_CONTENT,
                        message_id=custom_event.value["message_id"],
                        delta=custom_event.value["message"],
                        raw_event=event,
                    )
                )
                super()._dispatch_event(
                    TextMessageEndEvent(
                        type=EventType.TEXT_MESSAGE_END,
                        message_id=custom_event.value["message_id"],
                        raw_event=event,
                    )
                )
                return super()._dispatch_event(event)

            if custom_event.name == CustomEventNames.ManuallyEmitToolCall.value:
                # Emit the tool call events
                super()._dispatch_event(
                    ToolCallStartEvent(
                        type=EventType.TOOL_CALL_START,
                        tool_call_id=custom_event.value["id"],
                        tool_call_name=custom_event.value["name"],
                        parent_message_id=custom_event.value["id"],
                        raw_event=event,
                    )
                )
                super()._dispatch_event(
                    ToolCallArgsEvent(
                        type=EventType.TOOL_CALL_ARGS,
                        tool_call_id=custom_event.value["id"],
                        delta=custom_event.value["args"],
                        raw_event=event,
                    )
                )
                super()._dispatch_event(
                    ToolCallEndEvent(
                        type=EventType.TOOL_CALL_END,
                        tool_call_id=custom_event.value["id"],
                        raw_event=event,
                    )
                )
                return super()._dispatch_event(event)

            if custom_event.name == CustomEventNames.ManuallyEmitState.value:
                self.active_run["manually_emitted_state"] = custom_event.value
                return super()._dispatch_event(
                    StateSnapshotEvent(
                        type=EventType.STATE_SNAPSHOT,
                        snapshot=self.get_state_snapshot(self.active_run["manually_emitted_state"]),
                        raw_event=event,
                    )
                )

            if custom_event.name == "copilotkit_exit":
                return super()._dispatch_event(
                    CustomEvent(
                        type=EventType.CUSTOM,
                        name="Exit",
                        value=True,
                        raw_event=event,
                    )
                )

        # Handle filtering based on metadata for text messages and tool calls
        raw_event = getattr(event, 'raw_event', None)
        if raw_event:
            is_message_event = event.type in [
                EventType.TEXT_MESSAGE_START,
                EventType.TEXT_MESSAGE_CONTENT,
                EventType.TEXT_MESSAGE_END
            ]
            is_tool_event = event.type in [
                EventType.TOOL_CALL_START,
                EventType.TOOL_CALL_ARGS,
                EventType.TOOL_CALL_END
            ]

            metadata = getattr(raw_event, 'metadata', {}) or {}
            
            if "copilotkit:emit-tool-calls" in metadata:
                if metadata["copilotkit:emit-tool-calls"] is False and is_tool_event:
                    return ""  # Don't dispatch this event
            
            if "copilotkit:emit-messages" in metadata:
                if metadata["copilotkit:emit-messages"] is False and is_message_event:
                    return ""  # Don't dispatch this event

        return super()._dispatch_event(event)

    async def _handle_single_event(self, event: Any, state: State) -> AsyncGenerator[str, None]:
        """Override to add custom event processing for PredictState events"""
        
        # First, check if this is a raw event that should generate a PredictState event
        if event.get("event") == LangGraphEventTypes.OnChatModelStream.value:
            chunk = event.get("data", {}).get("chunk")
            tool_call_chunks = getattr(chunk, "tool_call_chunks", []) if chunk else []
            tool_call_data = tool_call_chunks[0] if tool_call_chunks else None
            predict_state_metadata = event.get("metadata", {}).get("copilotkit:emit-intermediate-state", [])

            tool_call_used_to_predict_state = False
            if tool_call_data and tool_call_data.get("name", None) and predict_state_metadata:
                tool_call_used_to_predict_state = any(
                    predict_state_tool.get("tool") == tool_call_data.get("name")
                    for predict_state_tool in predict_state_metadata
                )

            if tool_call_used_to_predict_state:
                yield self._dispatch_event(
                    CustomEvent(
                        type=EventType.CUSTOM,
                        name="PredictState",
                        value=predict_state_metadata,
                        raw_event=event
                    )
                )

        # Call the parent method to handle all other events
        async for event_str in super()._handle_single_event(event, state):
            yield event_str

    def langgraph_default_merge_state(self, state: State, messages: List[BaseMessage], tools: Any) -> State:
        """Override to add CopilotKit actions to the state"""
        merged_state = super().langgraph_default_merge_state(state, messages, tools)
        # Extract tools from the merged state and add them as CopilotKit actions
        tools_in_state = merged_state.get('tools', [])
        
        return {
            **merged_state,
            'copilotkit': {
                'actions': tools_in_state,
            },
        }
