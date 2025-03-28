"""
CrewAI Event Listener
"""
from typing import TypedDict, Optional
import asyncio
import uuid
from crewai.utilities.events import (
    FlowStartedEvent,
    MethodExecutionStartedEvent,
    MethodExecutionFinishedEvent,
    FlowFinishedEvent,
    LLMCallStartedEvent,
    LLMCallCompletedEvent,
    LLMCallFailedEvent,
    LLMStreamChunkEvent,
    ToolUsageStartedEvent,
    ToolUsageErrorEvent,
)
from crewai.utilities.events.base_event_listener import BaseEventListener

from copilotkit.runloop import queue_put
from copilotkit.protocol import (
    RuntimeEventTypes,
    RunStarted,
    RunFinished,
    NodeStarted,
    NodeFinished,
    TextMessageStart,
    TextMessageContent,
    TextMessageEnd,
)

class LocalExecutionContext(TypedDict):
    """
    Local execution context
    """
    current_message_id: Optional[str]
    current_tool_call_id: Optional[str]


_id_to_execution_context = {}

class CopilotKitCrewAIEventListener(BaseEventListener):
    """
    CopilotKit CrewAI Event Listener
    """

    def _get_execution_context(self, flow_id: int) -> LocalExecutionContext:
        """
        Get the execution context for a given ID
        """
        return _id_to_execution_context[flow_id]

    def _set_execution_context(self, flow_id: int, execution_context: LocalExecutionContext):
        """
        Set the execution context for a given ID
        """
        _id_to_execution_context[flow_id] = execution_context

    def _delete_execution_context(self, flow_id: int):
        """
        Delete the execution context for a given ID
        """
        del _id_to_execution_context[flow_id]

    # Flow lifecycle events

    async def aon_flow_started(self, source, event): # pylint: disable=unused-argument
        """
        Handle a flow started event
        """
        self._set_execution_context(id(source), LocalExecutionContext(
            current_message_id=None,
            current_tool_call_id=None
        ))
        await queue_put(RunStarted(
                type=RuntimeEventTypes.RUN_STARTED,
                state=source.state
            ), priority=True)

    async def aon_method_execution_started(self, source, event):
        """
        Handle a method execution started event
        """
        await queue_put(NodeStarted(
                type=RuntimeEventTypes.NODE_STARTED,
                node_name=event.method_name,
                state=source.state
            ), priority=True)

    async def aon_method_execution_finished(self, source, event):
        """
        Handle a method execution finished event
        """
        await queue_put(NodeFinished(
                type=RuntimeEventTypes.NODE_FINISHED,
                node_name=event.method_name,
                state=source.state
            ), priority=True)

    async def aon_flow_finished(self, source, event): # pylint: disable=unused-argument
        """
        Handle a flow finished event
        """
        self._delete_execution_context(id(source))
        await queue_put(RunFinished(
                type=RuntimeEventTypes.RUN_FINISHED,
                state=source.state
            ), priority=True)

    # LLM call events

    async def aon_llm_call_started(self, source, event): # pylint: disable=unused-argument
        """
        Handle an LLM call started event
        """
        message_id = str(uuid.uuid4())
        self._set_execution_context(id(source), LocalExecutionContext(
            current_message_id=message_id,
            current_tool_call_id=None
        ))

    async def aon_llm_call_completed(self, source, event): # pylint: disable=unused-argument
        """
        Handle an LLM call completed event
        """
        self._set_execution_context(id(source), LocalExecutionContext(
            current_message_id=None,
            current_tool_call_id=None
        ))

    async def aon_llm_call_failed(self, source, event): # pylint: disable=unused-argument
        """
        Handle an LLM call failed event
        """
        self._set_execution_context(id(source), LocalExecutionContext(
            current_message_id=None,
            current_tool_call_id=None
        ))

    async def aon_llm_stream_chunk(self, source, event):
        """
        Handle an LLM stream chunk event
        """
        execution_context = self._get_execution_context(id(source))
        if execution_context["current_message_id"] is None:
            return
        print(TextMessageContent(
            type=RuntimeEventTypes.TEXT_MESSAGE_CONTENT,
            messageId=execution_context["current_message_id"],
            content=event.chunk
        ), flush=True)

    def setup_listeners(self, crewai_event_bus):
        """
        Setup listeners for CrewAI events
        """
        @crewai_event_bus.on(FlowStartedEvent)
        def on_flow_started(source, event):
            asyncio.get_running_loop().create_task(self.aon_flow_started(source, event))

        @crewai_event_bus.on(MethodExecutionStartedEvent)
        def on_method_execution_started(source, event):
            asyncio.get_running_loop().create_task(self.aon_method_execution_started(source, event))

        @crewai_event_bus.on(MethodExecutionFinishedEvent)
        def on_method_execution_finished(source, event):
            asyncio.get_running_loop().create_task(
                self.aon_method_execution_finished(source, event)
            )

        @crewai_event_bus.on(FlowFinishedEvent)
        def on_flow_finished(source, event):
            asyncio.get_running_loop().create_task(self.aon_flow_finished(source, event))

        @crewai_event_bus.on(LLMCallStartedEvent)
        def on_llm_call_started(source, event):
            asyncio.get_running_loop().create_task(self.aon_llm_call_started(source, event))

        @crewai_event_bus.on(LLMCallCompletedEvent)
        def on_llm_call_completed(source, event):
            asyncio.get_running_loop().create_task(self.aon_llm_call_completed(source, event))

        @crewai_event_bus.on(LLMCallFailedEvent)
        def on_llm_call_failed(source, event):
            asyncio.get_running_loop().create_task(self.aon_llm_call_failed(source, event))

        @crewai_event_bus.on(LLMStreamChunkEvent)
        def on_llm_stream_chunk(source, event):
            asyncio.get_running_loop().create_task(self.aon_llm_stream_chunk(source, event))

        @crewai_event_bus.on(ToolUsageStartedEvent)
        def on_tool_usage_started(source, event: ToolUsageStartedEvent):
            pass

        @crewai_event_bus.on(ToolUsageErrorEvent)
        def on_tool_usage_error(source, event: ToolUsageErrorEvent):
            pass
