import json
import logging
from typing import Dict, Any, List, Optional, Union, AsyncGenerator
from enum import Enum
from .exc import CopilotKitMisuseError

logger = logging.getLogger(__name__)
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

try:
    from langchain.schema import BaseMessage
except ImportError:
    # Langchain >= 1.0.0
    from langchain_core.messages import BaseMessage


def should_emit_tool_call(
    tool_call_names: Dict[str, str],
    emit_tool_calls: Union[bool, str, List[str]],
    event,
) -> bool:
    """Check if a tool call event should be emitted based on the emit_tool_calls config.

    Extracted as a module-level function so it can be tested directly without
    needing to instantiate LangGraphAGUIAgent (which requires ag_ui_langgraph).

    Args:
        tool_call_names: Mapping of tool_call_id -> tool_call_name for id-based lookups.
        emit_tool_calls: The filtering config — True/False, a single tool name, or a list of names.
        event: The AG-UI event object (has optional tool_call_name/tool_call_id attributes).
    """
    if isinstance(emit_tool_calls, bool):
        return emit_tool_calls

    # Use getattr with None default — hasattr returns True even when the
    # attribute exists but is None, which would skip the id-lookup fallback.
    tool_call_name = getattr(event, 'tool_call_name', None)
    if tool_call_name is None:
        tool_call_id = getattr(event, 'tool_call_id', None)
        if tool_call_id is not None:
            tool_call_name = tool_call_names.get(tool_call_id)

    if tool_call_name is None:
        return True

    if isinstance(emit_tool_calls, str):
        return emit_tool_calls == tool_call_name
    if isinstance(emit_tool_calls, list):
        return tool_call_name in emit_tool_calls

    return True


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
TextMessageEvents = Union[
    TextMessageStartEvent, TextMessageContentEvent, TextMessageEndEvent
]
ToolCallEvents = Union[ToolCallStartEvent, ToolCallArgsEvent, ToolCallEndEvent]


class LangGraphAGUIAgent(LangGraphAgent):
    def __init__(
        self,
        *,
        name: str,
        graph: CompiledStateGraph,
        description: Optional[str] = None,
        config: Union[Optional[RunnableConfig], dict] = None,
    ):
        super().__init__(name=name, graph=graph, description=description, config=config)
        self.constant_schema_keys = self.constant_schema_keys + ["copilotkit"]
        self._tool_call_names: Dict[str, str] = {}

    def _should_emit_tool_call(
        self,
        emit_tool_calls: Union[bool, str, List[str]],
        event,
    ) -> bool:
        """Delegate to the module-level function with instance state."""
        return should_emit_tool_call(self._tool_call_names, emit_tool_calls, event)

    def _dispatch_event(self, event) -> str:
        """Override the dispatch event method to handle custom CopilotKit events and filtering.

        Note: Returns None for filtered events (which violates the str return type annotation,
        but the base class also violates it by returning event objects). The None values are
        filtered out in run() before reaching the encoder.
        """

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
                value = custom_event.value
                if not isinstance(value, dict):
                    raise CopilotKitMisuseError(
                        f"ManuallyEmitToolCall event 'value' must be a dict, got {type(value).__name__}"
                    )

                tool_call_id = value.get("id")
                tool_call_name = value.get("name")
                tool_call_args = value.get("args")

                if not isinstance(tool_call_id, str) or not tool_call_id.strip():
                    raise CopilotKitMisuseError(
                        f"ManuallyEmitToolCall event missing valid 'id': got {type(tool_call_id).__name__}"
                    )
                if not isinstance(tool_call_name, str) or not tool_call_name.strip():
                    raise CopilotKitMisuseError(
                        f"ManuallyEmitToolCall event missing valid 'name': got {type(tool_call_name).__name__}"
                    )
                if tool_call_args is None:
                    raise CopilotKitMisuseError(
                        f"ManuallyEmitToolCall event missing 'args' for tool_call_id={tool_call_id}"
                    )

                try:
                    delta = (
                        tool_call_args
                        if isinstance(tool_call_args, str)
                        else json.dumps(tool_call_args)
                    )
                except (TypeError, ValueError) as e:
                    raise CopilotKitMisuseError(
                        f"ManuallyEmitToolCall 'args' is not JSON-serializable for tool_call_id={tool_call_id}: {e}"
                    ) from e

                dispatched_start = False
                end_dispatched = False
                try:
                    super()._dispatch_event(
                        ToolCallStartEvent(
                            type=EventType.TOOL_CALL_START,
                            tool_call_id=tool_call_id,
                            tool_call_name=tool_call_name,
                            parent_message_id=tool_call_id,
                            raw_event=event,
                        )
                    )
                    dispatched_start = True
                    super()._dispatch_event(
                        ToolCallArgsEvent(
                            type=EventType.TOOL_CALL_ARGS,
                            tool_call_id=tool_call_id,
                            delta=delta,
                            raw_event=event,
                        )
                    )
                    super()._dispatch_event(
                        ToolCallEndEvent(
                            type=EventType.TOOL_CALL_END,
                            tool_call_id=tool_call_id,
                            raw_event=event,
                        )
                    )
                    end_dispatched = True
                except Exception:
                    if dispatched_start and not end_dispatched:
                        try:
                            super()._dispatch_event(
                                ToolCallEndEvent(
                                    type=EventType.TOOL_CALL_END,
                                    tool_call_id=tool_call_id,
                                    raw_event=event,
                                )
                            )
                        except Exception:
                            logger.error(
                                "Failed to emit compensating TOOL_CALL_END for %s",
                                tool_call_id,
                                exc_info=True,
                            )
                    raise
                return super()._dispatch_event(event)

            if custom_event.name == CustomEventNames.ManuallyEmitState.value:
                self.active_run["manually_emitted_state"] = custom_event.value
                return super()._dispatch_event(
                    StateSnapshotEvent(
                        type=EventType.STATE_SNAPSHOT,
                        snapshot=self.get_state_snapshot(
                            self.active_run["manually_emitted_state"]
                        ),
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
        raw_event = getattr(event, "raw_event", None)
        if raw_event:
            is_message_event = event.type in [
                EventType.TEXT_MESSAGE_START,
                EventType.TEXT_MESSAGE_CONTENT,
                EventType.TEXT_MESSAGE_END,
            ]
            is_tool_event = event.type in [
                EventType.TOOL_CALL_START,
                EventType.TOOL_CALL_ARGS,
                EventType.TOOL_CALL_END,
            ]

            # Track tool call names for filtering by name
            if event.type == EventType.TOOL_CALL_START:
                tc_id = getattr(event, 'tool_call_id', None)
                tc_name = getattr(event, 'tool_call_name', None)
                if tc_id and tc_name:
                    self._tool_call_names[tc_id] = tc_name

            # Handle both dict and object cases for raw_event
            # See: https://github.com/CopilotKit/CopilotKit/issues/2066
            metadata = (
                raw_event.get("metadata", {})
                if isinstance(raw_event, dict)
                else getattr(raw_event, "metadata", {})
            ) or {}

            if "copilotkit:emit-tool-calls" in metadata:
                emit_tool_calls = metadata["copilotkit:emit-tool-calls"]
                if is_tool_event and not self._should_emit_tool_call(emit_tool_calls, event):
                    return None  # Don't dispatch this event

            # Clean up tracked names after filtering to prevent memory leak.
            # Must happen AFTER the filter so TOOL_CALL_END can still resolve its name.
            if event.type == EventType.TOOL_CALL_END:
                tc_id = getattr(event, 'tool_call_id', None)
                if tc_id:
                    self._tool_call_names.pop(tc_id, None)

            if "copilotkit:emit-messages" in metadata:
                if metadata["copilotkit:emit-messages"] is False and is_message_event:
                    return None  # Don't dispatch this event

        return super()._dispatch_event(event)

    async def run(self, input):
        """Override run to filter out None events from _dispatch_event filtering."""
        async for event in super().run(input):
            if event is not None:
                yield event

    async def _handle_single_event(
        self, event: Any, state: State
    ) -> AsyncGenerator[str, None]:
        """Override to add custom event processing for PredictState events"""

        # First, check if this is a raw event that should generate a PredictState event
        if event.get("event") == LangGraphEventTypes.OnChatModelStream.value:
            predict_state_metadata = event.get("metadata", {}).get(
                "copilotkit:emit-intermediate-state", None
            )
            if predict_state_metadata is not None:
                event["metadata"]["predict_state"] = predict_state_metadata

        # Call the parent method to handle all other events
        async for event_str in super()._handle_single_event(event, state):
            yield event_str

    def langgraph_default_merge_state(
        self, state: State, messages: List[BaseMessage], input: Any
    ) -> State:
        """Override to add CopilotKit actions to the state"""
        merged_state = super().langgraph_default_merge_state(state, messages, input)
        # Extract tools from the merged state and add them as CopilotKit actions
        agui_properties = merged_state.get("ag-ui", {}) or merged_state

        return {
            **merged_state,
            "copilotkit": {
                "actions": [
                    a.model_dump() if hasattr(a, "model_dump") else a
                    for a in agui_properties.get("tools", [])
                ],
                "context": [
                    c.model_dump() if hasattr(c, "model_dump") else c
                    for c in agui_properties.get("context", [])
                ],
            },
        }

    def dict_repr(self):
        """Return dictionary representation of the agent"""
        return {
            "name": self.name,
            "description": self.description or "",
            "type": "langgraph_agui",
        }
