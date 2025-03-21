"""
CrewAI Event Listener
"""
import asyncio

from crewai.utilities.events import (
    FlowStartedEvent,
    MethodExecutionStartedEvent,
    MethodExecutionFinishedEvent,
    FlowFinishedEvent
)
from crewai.utilities.events.base_event_listener import BaseEventListener

from copilotkit.runloop import queue_put
from copilotkit.protocol import (
    RuntimeEventTypes,
    RunStarted,
    RunFinished,
    NodeStarted,
    NodeFinished,
)

#  if isinstance(event, FlowStartedEvent):
#             await queue_put(RunStarted(
#                 type=RuntimeEventTypes.RUN_STARTED,
#                 state=flow.state
#             ), priority=True)
#         elif isinstance(event, MethodExecutionStartedEvent):
#             await queue_put(NodeStarted(
#                 type=RuntimeEventTypes.NODE_STARTED,
#                 node_name=event.method_name,
#                 state=flow.state
#             ), priority=True)
#         elif isinstance(event, MethodExecutionFinishedEvent):
#             await queue_put(NodeFinished(
#                 type=RuntimeEventTypes.NODE_FINISHED,
#                 node_name=event.method_name,
#                 state=flow.state
#             ), priority=True)
#         elif isinstance(event, FlowFinishedEvent):
#             await queue_put(RunFinished(
#                 type=RuntimeEventTypes.RUN_FINISHED,
#                 state=flow.state
#             ), priority=True)

class CopilotKitCrewAIEventListener(BaseEventListener):
    """
    CopilotKit CrewAI Event Listener
    """

    async def aon_flow_started(self, source, event): # pylint: disable=unused-argument
        """
        Handle a flow started event
        """
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
        await queue_put(RunFinished(
                type=RuntimeEventTypes.RUN_FINISHED,
                state=source.state
            ), priority=True)

    def setup_listeners(self, crewai_event_bus):
        """
        Setup listeners for CrewAI events
        """
        @crewai_event_bus.on(FlowStartedEvent)
        def on_flow_started(source, event):
            print("on_flow_started")
            asyncio.get_running_loop().create_task(self.aon_flow_started(source, event))

        @crewai_event_bus.on(MethodExecutionStartedEvent)
        def on_method_execution_started(source, event):
            print("on_method_execution_started")
            asyncio.get_running_loop().create_task(self.aon_method_execution_started(source, event))

        @crewai_event_bus.on(MethodExecutionFinishedEvent)
        def on_method_execution_finished(source, event):
            print("on_method_execution_finished")
            asyncio.get_running_loop().create_task(
                self.aon_method_execution_finished(source, event)
            )

        @crewai_event_bus.on(FlowFinishedEvent)
        def on_flow_finished(source, event):
            print("on_flow_finished")
            asyncio.get_running_loop().create_task(self.aon_flow_finished(source, event))
