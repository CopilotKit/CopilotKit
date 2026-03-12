# Copyright 2025 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import asyncio
import logging
import json
from typing import List, Optional, override
from google.adk.agents.invocation_context import new_invocation_context_id
from google.adk.events.event_actions import EventActions

from a2a.server.agent_execution import RequestContext
from google.adk.agents.llm_agent import LlmAgent
from google.adk.artifacts import InMemoryArtifactService
from a2a.server.events.event_queue import EventQueue
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.a2a.executor.a2a_agent_executor import (
    A2aAgentExecutorConfig,
    A2aAgentExecutor,
)
from a2a.types import AgentCapabilities, AgentCard, AgentExtension
from a2ui.a2ui_extension import is_a2ui_part, try_activate_a2ui_extension, A2UI_EXTENSION_URI, STANDARD_CATALOG_ID, SUPPORTED_CATALOG_IDS_KEY, get_a2ui_agent_extension, A2UI_CLIENT_CAPABILITIES_KEY
from google.adk.a2a.converters import event_converter
from a2a.server.events import Event as A2AEvent
from google.adk.events.event import Event
from google.adk.agents.invocation_context import InvocationContext
from google.adk.a2a.converters import part_converter
from subagent_route_manager import SubagentRouteManager

from agent import OrchestratorAgent
import part_converters

logger = logging.getLogger(__name__)


class OrchestratorAgentExecutor(A2aAgentExecutor):
    """Contact AgentExecutor Example."""

    def __init__(self, base_url: str, agent: LlmAgent):
        self._base_url = base_url

        config = A2aAgentExecutorConfig(
            gen_ai_part_converter=part_converters.convert_genai_part_to_a2a_part,
            a2a_part_converter=part_converters.convert_a2a_part_to_genai_part,
            event_converter=self.convert_event_to_a2a_events_and_save_surface_id_to_subagent_name,
        )

        runner = Runner(
            app_name=agent.name,
            agent=agent,
            artifact_service=InMemoryArtifactService(),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
        )

        super().__init__(runner=runner, config=config)

    @classmethod
    def convert_event_to_a2a_events_and_save_surface_id_to_subagent_name(
        cls,
        event: Event,
        invocation_context: InvocationContext,
        task_id: Optional[str] = None,
        context_id: Optional[str] = None,
        part_converter: part_converter.GenAIPartToA2APartConverter = part_converter.convert_genai_part_to_a2a_part,
    ) -> List[A2AEvent]:
        a2a_events = event_converter.convert_event_to_a2a_events(
            event,
            invocation_context,
            task_id,
            context_id,
            part_converter,
        )

        for a2a_event in a2a_events:
            # Try to populate subagent agent card if available.
            subagent_card = None
            if (active_subagent_name := event.author):
                # We need to find the subagent by name
                if (subagent := next((sub for sub in invocation_context.agent.sub_agents if sub.name == active_subagent_name), None)):
                    try:
                        subagent_card = json.loads(subagent.description)
                    except Exception:
                        logger.warning(f"Failed to parse agent description for {active_subagent_name}")
            if subagent_card:
                if a2a_event.metadata is None:
                    a2a_event.metadata = {}
                a2a_event.metadata["a2a_subagent"] = subagent_card
                        
            for a2a_part in a2a_event.status.message.parts:
                if (
                    is_a2ui_part(a2a_part)
                    and (begin_rendering := a2a_part.root.data.get("beginRendering"))
                    and (surface_id := begin_rendering.get("surfaceId"))
                ):                    
                    asyncio.run_coroutine_threadsafe(
                        SubagentRouteManager.set_route_to_subagent_name(
                            surface_id,
                            event.author,
                            invocation_context.session_service,
                            invocation_context.session,
                        ),
                        asyncio.get_event_loop(),
                    )

        return a2a_events

    def get_agent_card(self) -> AgentCard:
        return AgentCard(
            name="Orchestrator Agent",
            description="This agent orchestrates to multiple subagents to provide.",
            url=self._base_url,
            version="1.0.0",
            default_input_modes=OrchestratorAgent.SUPPORTED_CONTENT_TYPES,
            default_output_modes=OrchestratorAgent.SUPPORTED_CONTENT_TYPES,
            capabilities=AgentCapabilities(
                streaming=True,
                extensions=[get_a2ui_agent_extension()],
            ),
            skills=[],
        )

    @override
    async def _prepare_session(
        self,
        context: RequestContext,
        run_request: AgentRunRequest,
        runner: Runner,
    ):
        session = await super()._prepare_session(context, run_request, runner)
        
        if try_activate_a2ui_extension(context):
            client_capabilities = context.message.metadata.get(A2UI_CLIENT_CAPABILITIES_KEY) if context.message and context.message.metadata else None
            
            await runner.session_service.append_event(
                    session,
                    Event(
                        invocation_id=new_invocation_context_id(),
                        author="system",
                        actions=EventActions(
                            state_delta={ 
                                # These values are used to configure A2UI messages to remote agent calls         
                                "use_ui": True,
                                "client_capabilities": client_capabilities 
                            }
                        ),
                    ),
                )
            
        return session