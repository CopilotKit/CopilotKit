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

import logging
from typing import override

from a2a.server.agent_execution import RequestContext

from google.adk.agents.invocation_context import new_invocation_context_id
from google.adk.artifacts import InMemoryArtifactService
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.a2a.converters.request_converter import AgentRunRequest
from google.adk.a2a.executor.a2a_agent_executor import (
    A2aAgentExecutorConfig,
    A2aAgentExecutor,
)
from a2ui.a2ui_extension import A2UI_EXTENSION_URI, get_a2ui_agent_extension, try_activate_a2ui_extension, A2UI_CLIENT_CAPABILITIES_KEY
from component_catalog_builder import ComponentCatalogBuilder
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2a.types import AgentExtension
from a2ui_session_util import A2UI_ENABLED_STATE_KEY, A2UI_CATALOG_URI_STATE_KEY, A2UI_SCHEMA_STATE_KEY
from agent import RIZZCHARTS_CATALOG_URI
from a2ui.a2ui_extension import STANDARD_CATALOG_ID

from agent import rizzchartsAgent
import part_converter
from pathlib import Path

logger = logging.getLogger(__name__)


class RizzchartsAgentExecutor(A2aAgentExecutor):
    """Contact AgentExecutor Example."""

    def __init__(self, base_url: str):
        self._base_url = base_url
        
        spec_root = Path(__file__).parent / "../../../../../specification/0.8/json"
        
        self._component_catalog_builder = ComponentCatalogBuilder(
            a2ui_schema_path=str(spec_root.joinpath("server_to_client.json")),
            uri_to_local_catalog_path={
                STANDARD_CATALOG_ID: str(spec_root.joinpath("standard_catalog_definition.json")),
                RIZZCHARTS_CATALOG_URI: "rizzcharts_catalog_definition.json",
            },
            default_catalog_uri=STANDARD_CATALOG_ID
        )
        agent = rizzchartsAgent.build_agent()
        runner = Runner(
            app_name=agent.name,
            agent=agent,
            artifact_service=InMemoryArtifactService(),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
        )
        self._part_converter = part_converter.A2uiPartConverter()
        config = A2aAgentExecutorConfig(
            gen_ai_part_converter=self._part_converter.convert_genai_part_to_a2a_part
        )
        super().__init__(runner=runner, config=config)

    def get_agent_card(self) -> AgentCard:
        return AgentCard(
            name="Ecommerce Dashboard Agent",
            description="This agent visualizes ecommerce data, showing sales breakdowns, YOY revenue performance, and regional sales outliers.",
            url=self._base_url,
            version="1.0.0",
            default_input_modes=rizzchartsAgent.SUPPORTED_CONTENT_TYPES,
            default_output_modes=rizzchartsAgent.SUPPORTED_CONTENT_TYPES,
            capabilities=AgentCapabilities(
                streaming=True,
                extensions=[get_a2ui_agent_extension()],
            ),
            skills=[
                AgentSkill(
                    id="view_sales_by_category",
                    name="View Sales by Category",
                    description="Displays a pie chart of sales broken down by product category for a given time period.",
                    tags=["sales", "breakdown", "category", "pie chart", "revenue"],
                    examples=[
                        "show my sales breakdown by product category for q3",
                        "What's the sales breakdown for last month?",
                    ],
                ),
                AgentSkill(
                    id="view_regional_outliers",
                    name="View Regional Sales Outliers",
                    description="Displays a map showing regional sales outliers or store-level performance.",
                    tags=["sales", "regional", "outliers", "stores", "map", "performance"],
                    examples=[
                        "interesting. were there any outlier stores",
                        "show me a map of store performance",
                    ],
                ),
            ],
        )

    @override
    async def _prepare_session(
        self,
        context: RequestContext,
        run_request: AgentRunRequest,
        runner: Runner,
    ):
        logger.info(f"Loading session for message {context.message}")

        session = await super()._prepare_session(context, run_request, runner)

        if "base_url" not in session.state:
            session.state["base_url"] = self._base_url
                
        use_ui = try_activate_a2ui_extension(context)
        if use_ui:
            a2ui_schema, catalog_uri = self._component_catalog_builder.load_a2ui_schema(client_ui_capabilities=context.message.metadata.get(A2UI_CLIENT_CAPABILITIES_KEY) if context.message and context.message.metadata else None)

            self._part_converter.set_a2ui_schema(a2ui_schema)
        
            await runner.session_service.append_event(
                session,
                Event(
                    invocation_id=new_invocation_context_id(),
                    author="system",
                    actions=EventActions(
                        state_delta={
                            A2UI_ENABLED_STATE_KEY: use_ui,
                            A2UI_SCHEMA_STATE_KEY: a2ui_schema,
                            A2UI_CATALOG_URI_STATE_KEY: catalog_uri,
                        }
                    ),
                ),
            )

        return session
