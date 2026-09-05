import inspect
import json
import logging
from collections.abc import AsyncGenerator
from enum import Enum
from typing import Any

from ag_ui.core import (
    CustomEvent,
    EventType,
    MessagesSnapshotEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from ag_ui_langgraph import LangGraphAgent
from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph

from .exc import CopilotKitMisuseError

logger = logging.getLogger(__name__)

try:
    from langchain.schema import BaseMessage
except ImportError:
    # Langchain >= 1.0.0
    from langchain_core.messages import BaseMessage


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


State = dict[str, Any]
SchemaKeys = dict[str, list[str]]
TextMessageEvents = (
    TextMessageStartEvent | TextMessageContentEvent | TextMessageEndEvent
)
ToolCallEvents = ToolCallStartEvent | ToolCallArgsEvent | ToolCallEndEvent


class LangGraphAGUIAgent(LangGraphAgent):
    def __init__(
        self,
        *,
        name: str,
        graph: CompiledStateGraph,
        description: str | None = None,
        config: RunnableConfig | None | dict = None,
        **kwargs: Any,
    ):
        """Wrap a LangGraph graph as a CopilotKit-flavored AG-UI agent.

        Extra keyword arguments are forwarded to ``LangGraphAgent`` unchanged.
        This is deliberate rather than a restated signature: ``clone()`` rebuilds
        the agent through ``type(self)(...)`` and forwards the base class's own
        behavior flags, and ``add_langgraph_fastapi_endpoint`` clones on every
        request. A closed signature turns each flag the base adds into a 500 on
        every request, and leaves those flags — such as the ``emit_raw_events``
        payload opt-out — unreachable for CopilotKit users in the meantime.
        """
        super().__init__(
            name=name,
            graph=graph,
            description=description,
            config=config,
            **kwargs,
        )
        self.constant_schema_keys = self.constant_schema_keys + ["copilotkit"]
        self._copilotkit_runtime_payload: dict[str, Any] | None = None

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
                self._materialize_tool_call_events(
                    custom_event.value,
                    event,
                    parent_message_id=None,
                )
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

            # Handle both dict and object cases for raw_event
            # See: https://github.com/CopilotKit/CopilotKit/issues/2066
            metadata = (
                raw_event.get("metadata", {})
                if isinstance(raw_event, dict)
                else getattr(raw_event, "metadata", {})
            ) or {}

            if metadata.get("copilotkit:emit-tool-calls") is False and is_tool_event:
                self._remember_hidden_id(
                    "copilotkit_hidden_tool_call_ids",
                    getattr(event, "tool_call_id", None),
                )
                return None  # Don't dispatch this event

            if metadata.get("copilotkit:emit-messages") is False and is_message_event:
                self._remember_hidden_id(
                    "copilotkit_hidden_message_ids",
                    getattr(event, "message_id", None),
                )
                return None  # Don't dispatch this event

        return super()._dispatch_event(event)

    def _remember_hidden_id(self, bucket: str, entity_id: str | None) -> None:
        """Record the id of a message/tool call suppressed from streaming.

        `get_state_and_messages_snapshots` reads these sets back to keep the
        MESSAGES_SNAPSHOT it emits consistent with what streaming already
        withheld under the same `copilotkit:emit-messages` /
        `copilotkit:emit-tool-calls` metadata (see CopilotKit/CopilotKit#3861).
        """
        active_run = getattr(self, "active_run", None)
        if active_run is None or not entity_id:
            return
        active_run.setdefault(bucket, set()).add(entity_id)

    async def get_state_and_messages_snapshots(
        self, config: RunnableConfig
    ) -> AsyncGenerator[Any, None]:
        """Filter suppressed messages/tool calls out of the MESSAGES_SNAPSHOT.

        The base implementation reads messages straight from the LangGraph
        checkpoint, so a message produced while `copilotkit:emit-messages` or
        `copilotkit:emit-tool-calls` was False (e.g. a subagent invoked from a
        tool with a customized config) still reaches the frontend here even
        though `_dispatch_event` already withheld it from the live stream.
        Reconcile the snapshot with the same ids `_dispatch_event` recorded.
        """
        await self._load_persisted_hidden_visibility(config)
        await self._persist_hidden_visibility(config)
        async for event in super().get_state_and_messages_snapshots(config):
            if event is not None and event.type == EventType.MESSAGES_SNAPSHOT:
                event = self._filter_hidden_messages(event)
            yield event

    def _filter_hidden_messages(
        self, event: MessagesSnapshotEvent
    ) -> MessagesSnapshotEvent:
        active_run = getattr(self, "active_run", None) or {}
        hidden_message_ids = active_run.get("copilotkit_hidden_message_ids") or set()
        hidden_tool_call_ids = (
            active_run.get("copilotkit_hidden_tool_call_ids") or set()
        )
        if not hidden_message_ids and not hidden_tool_call_ids:
            return event

        filtered_messages = []
        for message in event.messages:
            tool_call_id = getattr(message, "tool_call_id", None)
            if tool_call_id is not None:
                # Tool result of a hidden tool call: drop, would otherwise be
                # an orphaned ToolMessage on the frontend.
                if (
                    message.id in hidden_message_ids
                    or tool_call_id in hidden_tool_call_ids
                ):
                    continue
                filtered_messages.append(message)
                continue

            update: dict[str, Any] = {}
            if message.id in hidden_message_ids:
                update["content"] = None
            tool_calls = getattr(message, "tool_calls", None)
            if tool_calls:
                kept_tool_calls = [
                    tool_call
                    for tool_call in tool_calls
                    if tool_call.id not in hidden_tool_call_ids
                ]
                if len(kept_tool_calls) != len(tool_calls):
                    update["tool_calls"] = kept_tool_calls or None

            if not update:
                # Nothing about this message was hidden — leave it untouched,
                # including whatever content/tool_calls it naturally has.
                filtered_messages.append(message)
                continue

            remaining_content = update.get("content", message.content)
            remaining_tool_calls = update.get("tool_calls", tool_calls)
            if not remaining_content and not remaining_tool_calls:
                # The whole turn was hidden: no text and no surviving tool
                # calls, so skip it rather than emit an empty bubble.
                continue

            filtered_messages.append(message.model_copy(update=update))

        return event.model_copy(update={"messages": filtered_messages})

    async def _persist_hidden_visibility(self, config: RunnableConfig) -> None:
        """Persist suppressed message and tool-call IDs in checkpoint messages."""
        active_run = getattr(self, "active_run", None) or {}
        hidden_message_ids = active_run.get("copilotkit_hidden_message_ids") or set()
        hidden_tool_call_ids = (
            active_run.get("copilotkit_hidden_tool_call_ids") or set()
        )
        if not hidden_message_ids and not hidden_tool_call_ids:
            return

        state = await self.graph.aget_state(config)
        messages = (state.values or {}).get("messages", [])
        updates = []
        for message in messages:
            additional_kwargs = dict(getattr(message, "additional_kwargs", {}) or {})
            markers = dict(additional_kwargs.get("copilotkit_visibility", {}) or {})
            changed = False

            if (
                getattr(message, "id", None) in hidden_message_ids
                and markers.get("hidden_message") is not True
            ):
                markers["hidden_message"] = True
                changed = True

            tool_call_id = getattr(message, "tool_call_id", None)
            if (
                tool_call_id in hidden_tool_call_ids
                and markers.get("hidden_tool_call") is not True
            ):
                markers["hidden_tool_call"] = True
                changed = True

            tool_calls = getattr(message, "tool_calls", None) or []
            hidden_calls = {
                tool_call.get("id")
                for tool_call in tool_calls
                if tool_call.get("id") in hidden_tool_call_ids
            }
            if hidden_calls:
                persisted_calls = set(markers.get("hidden_tool_call_ids", []))
                if not hidden_calls.issubset(persisted_calls):
                    markers["hidden_tool_call_ids"] = sorted(
                        persisted_calls | hidden_calls
                    )
                    changed = True

            if changed:
                additional_kwargs["copilotkit_visibility"] = markers
                updates.append(
                    message.model_copy(update={"additional_kwargs": additional_kwargs})
                )

        if updates:
            await self.graph.aupdate_state(config, {"messages": updates})

    async def _load_persisted_hidden_visibility(self, config: RunnableConfig) -> None:
        """Load visibility markers from checkpoint messages into the active run."""
        active_run = getattr(self, "active_run", None)
        if active_run is None:
            return

        state = await self.graph.aget_state(config)
        hidden_message_ids = active_run.setdefault(
            "copilotkit_hidden_message_ids", set()
        )
        hidden_tool_call_ids = active_run.setdefault(
            "copilotkit_hidden_tool_call_ids", set()
        )
        for message in (state.values or {}).get("messages", []):
            markers = (getattr(message, "additional_kwargs", {}) or {}).get(
                "copilotkit_visibility", {}
            ) or {}
            if markers.get("hidden_message"):
                hidden_message_ids.add(message.id)
            if markers.get("hidden_tool_call"):
                tool_call_id = getattr(message, "tool_call_id", None)
                if tool_call_id:
                    hidden_tool_call_ids.add(tool_call_id)
            hidden_tool_call_ids.update(markers.get("hidden_tool_call_ids", []))

    async def run(self, input):
        """Override run to filter out None events from _dispatch_event filtering."""
        self._copilotkit_runtime_payload = self._serialize_copilotkit_runtime_payload(
            input
        )
        try:
            async for event in super().run(input):
                if event is not None:
                    yield event
        finally:
            self._copilotkit_runtime_payload = None

    async def _handle_single_event(
        self, event: Any, state: State
    ) -> AsyncGenerator[str, None]:
        """Override to add custom event processing for PredictState events"""

        self._record_hidden_output_ids(event)

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

        if event.get("event") != "on_chain_end":
            return

        output = (event.get("data") or {}).get("output")
        copilotkit_state = (
            output.get("copilotkit") if isinstance(output, dict) else None
        )
        if not isinstance(copilotkit_state, dict):
            return

        intercepted_tool_calls = copilotkit_state.get("intercepted_tool_calls")
        parent_message_id = copilotkit_state.get("original_ai_message_id")
        if not isinstance(intercepted_tool_calls, list) or not isinstance(
            parent_message_id, str
        ):
            return

        valid_calls = [
            call
            for call in intercepted_tool_calls
            if self._materialize_tool_call_events(
                call, event, parent_message_id=parent_message_id, dispatch=False
            )
        ]
        streamed_tool_call_ids = (getattr(self, "active_run", None) or {}).setdefault(
            "streamed_tool_call_ids", set()
        )
        for call in valid_calls:
            tool_call_id = call["id"]
            # The parent adapter records streamed IDs even when lifecycle emission is suppressed.
            if tool_call_id in streamed_tool_call_ids:
                continue
            transformed_events: list[Any] = []
            if self._materialize_tool_call_events(
                call,
                event,
                parent_message_id=parent_message_id,
                dispatch_via_adapter=True,
                dispatched_events=transformed_events,
            ):
                streamed_tool_call_ids.add(tool_call_id)
            for transformed_event in transformed_events:
                if transformed_event is not None:
                    yield transformed_event

    def _record_hidden_output_ids(self, event: Any) -> None:
        """Record IDs from source outputs hidden by delegated run metadata."""
        metadata = event.get("metadata") or {}
        hide_messages = metadata.get("copilotkit:emit-messages") is False
        hide_tool_calls = metadata.get("copilotkit:emit-tool-calls") is False
        namespace = metadata.get("langgraph_checkpoint_ns")
        active_run = getattr(self, "active_run", None)
        if active_run is None:
            return

        hidden_namespaces = active_run.setdefault(
            "copilotkit_hidden_output_namespaces", {}
        )
        if namespace and (hide_messages or hide_tool_calls):
            hidden_namespaces[namespace] = {
                "messages": hide_messages,
                "tool_calls": hide_tool_calls,
            }
        if not hide_messages and not hide_tool_calls and namespace:
            visibility = hidden_namespaces.get(namespace)
            if visibility:
                hide_messages = visibility["messages"]
                hide_tool_calls = visibility["tool_calls"]
        if not hide_messages and not hide_tool_calls:
            return

        output = (event.get("data") or {}).get("output")
        outputs = output.get("messages", []) if isinstance(output, dict) else [output]
        if not isinstance(outputs, list):
            outputs = [outputs]

        for message in outputs:
            if message is None:
                continue
            if hide_messages:
                self._remember_hidden_id(
                    "copilotkit_hidden_message_ids", getattr(message, "id", None)
                )
            if hide_tool_calls:
                self._remember_hidden_id(
                    "copilotkit_hidden_tool_call_ids",
                    getattr(message, "tool_call_id", None),
                )
                for tool_call in getattr(message, "tool_calls", None) or []:
                    self._remember_hidden_id(
                        "copilotkit_hidden_tool_call_ids", tool_call.get("id")
                    )

    def _materialize_tool_call_events(
        self,
        value: Any,
        event: Any,
        *,
        parent_message_id: str | None,
        dispatch: bool = True,
        dispatch_via_adapter: bool = False,
        dispatched_events: list[Any] | None = None,
    ) -> bool:
        if not isinstance(value, dict):
            if dispatch:
                raise CopilotKitMisuseError(
                    f"ManuallyEmitToolCall event 'value' must be a dict, got {type(value).__name__}"
                )
            return False

        tool_call_id = value.get("id")
        tool_call_name = value.get("name")
        tool_call_args = value.get("args")
        if not isinstance(tool_call_id, str) or not tool_call_id.strip():
            if dispatch:
                raise CopilotKitMisuseError(
                    f"ManuallyEmitToolCall event missing valid 'id': got {type(tool_call_id).__name__}"
                )
            logger.warning("Skipping intercepted tool call with invalid id")
            return False
        if not isinstance(tool_call_name, str) or not tool_call_name.strip():
            if dispatch:
                raise CopilotKitMisuseError(
                    f"ManuallyEmitToolCall event missing valid 'name': got {type(tool_call_name).__name__}"
                )
            logger.warning(
                "Skipping intercepted tool call %s with invalid name", tool_call_id
            )
            return False
        if tool_call_args is None:
            if dispatch:
                raise CopilotKitMisuseError(
                    f"ManuallyEmitToolCall event missing 'args' for tool_call_id={tool_call_id}"
                )
            logger.warning(
                "Skipping intercepted tool call %s without args", tool_call_id
            )
            return False
        try:
            delta = (
                tool_call_args
                if isinstance(tool_call_args, str)
                else json.dumps(tool_call_args)
            )
        except (TypeError, ValueError) as error:
            if dispatch:
                raise CopilotKitMisuseError(
                    f"ManuallyEmitToolCall 'args' is not JSON-serializable for tool_call_id={tool_call_id}: {error}"
                ) from error
            logger.warning(
                "Skipping intercepted tool call %s with non-serializable args",
                tool_call_id,
            )
            return False
        if not dispatch:
            return True

        dispatched_start = False
        end_dispatched = False
        dispatch_event = (
            self._dispatch_event if dispatch_via_adapter else super()._dispatch_event
        )
        try:
            start_event = dispatch_event(
                ToolCallStartEvent(
                    type=EventType.TOOL_CALL_START,
                    tool_call_id=tool_call_id,
                    tool_call_name=tool_call_name,
                    parent_message_id=parent_message_id or tool_call_id,
                    raw_event=event,
                )
            )
            if dispatched_events is not None:
                dispatched_events.append(start_event)
            dispatched_start = True
            args_event = dispatch_event(
                ToolCallArgsEvent(
                    type=EventType.TOOL_CALL_ARGS,
                    tool_call_id=tool_call_id,
                    delta=delta,
                    raw_event=event,
                )
            )
            if dispatched_events is not None:
                dispatched_events.append(args_event)
            end_event = dispatch_event(
                ToolCallEndEvent(
                    type=EventType.TOOL_CALL_END,
                    tool_call_id=tool_call_id,
                    raw_event=event,
                )
            )
            if dispatched_events is not None:
                dispatched_events.append(end_event)
            end_dispatched = True
        except Exception:
            if dispatched_start and not end_dispatched:
                try:
                    end_event = dispatch_event(
                        ToolCallEndEvent(
                            type=EventType.TOOL_CALL_END,
                            tool_call_id=tool_call_id,
                            raw_event=event,
                        )
                    )
                    if dispatched_events is not None:
                        dispatched_events.append(end_event)
                except Exception:
                    logger.exception(
                        "Failed to emit compensating TOOL_CALL_END for %s",
                        tool_call_id,
                    )
            raise
        return True

    @staticmethod
    def _serialize_copilotkit_runtime_payload(input: Any) -> dict[str, Any]:
        """Build the CopilotKit payload that subgraphs need in runtime context."""
        tools = [
            tool.model_dump() if hasattr(tool, "model_dump") else tool
            for tool in (getattr(input, "tools", None) or [])
        ]
        context = [
            item.model_dump() if hasattr(item, "model_dump") else item
            for item in (getattr(input, "context", None) or [])
        ]
        return {
            "actions": tools,
            "context": context,
        }

    def get_stream_kwargs(
        self,
        input: Any,
        subgraphs: bool = False,
        version: str = "v2",
        config: RunnableConfig | None | dict = None,
        context: dict[str, Any] | None = None,
        fork: Any | None = None,
    ) -> dict[str, Any]:
        """Thread CopilotKit payload through LangGraph runtime context for subgraphs."""
        supports_context = (
            "context" in inspect.signature(self.graph.astream_events).parameters
        )
        merged_context = dict(context or {})
        captured_payload = self._copilotkit_runtime_payload
        if captured_payload is not None:
            if supports_context:
                existing_copilotkit = merged_context.get("copilotkit") or {}
                merged_context["copilotkit"] = {
                    **existing_copilotkit,
                    **captured_payload,
                }
            else:
                next_config = dict(config or {})
                configurable = dict(next_config.get("configurable") or {})
                existing_copilotkit = configurable.get("copilotkit") or {}
                configurable["copilotkit"] = {
                    **existing_copilotkit,
                    **captured_payload,
                }
                next_config["configurable"] = configurable
                config = next_config
        stream_kwargs = super().get_stream_kwargs(
            input=input,
            subgraphs=subgraphs,
            version=version,
            config=config,
            context=merged_context,
            fork=fork,
        )
        return stream_kwargs

    def langgraph_default_merge_state(
        self, state: State, messages: list[BaseMessage], input: Any
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
