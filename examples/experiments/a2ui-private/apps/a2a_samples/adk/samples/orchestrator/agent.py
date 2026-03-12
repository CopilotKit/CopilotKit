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

import json
import logging
import os
from typing import List
from a2a.client import A2ACardResolver
from a2a.extensions.common import HTTP_EXTENSION_HEADER
from google.adk.models.lite_llm import LiteLlm
from google.adk.agents.llm_agent import LlmAgent
from google.adk.agents.remote_a2a_agent import RemoteA2aAgent, DEFAULT_TIMEOUT
from google.adk.planners.built_in_planner import BuiltInPlanner
from google.genai import types as genai_types
import httpx
import re
import part_converters
from google.adk.agents.callback_context import  CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from subagent_route_manager import SubagentRouteManager
from a2ui.a2ui_extension import is_a2ui_part, A2UI_EXTENSION_URI
from typing import override
from a2a.types import TransportProtocol as A2ATransport

logger = logging.getLogger(__name__)
from a2a.client.middleware import ClientCallInterceptor
from a2a.client.client import ClientConfig as A2AClientConfig
from a2a.client.client_factory import ClientFactory as A2AClientFactory
from a2ui.a2ui_extension import A2UI_CLIENT_CAPABILITIES_KEY

class A2UIMetadataInterceptor(ClientCallInterceptor):
    @override
    async def intercept(
        self,
        method_name: str,
        request_payload: dict[str, Any],
        http_kwargs: dict[str, Any],
        agent_card: AgentCard | None,
        context: ClientCallContext | None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Enables the A2UI extension header and adds A2UI client capabilities to remote agent message metadata."""
        logger.info("Intercepting client call to method: " + method_name + " and payload " + json.dumps(request_payload))
                
        if context and context.state and context.state.get("use_ui"):
            # Add A2UI extension header
            http_kwargs["headers"] = {HTTP_EXTENSION_HEADER: A2UI_EXTENSION_URI}
            
            # Add A2UI client capabilities (supported catalogs, etc) to message metadata
            if (params := request_payload.get("params")) and (message := params.get("message")):            
                client_capabilities = context.state.get("client_capabilities")                
                if "metadata" not in message:
                    message["metadata"] = {}
                message["metadata"][A2UI_CLIENT_CAPABILITIES_KEY] = client_capabilities
                logger.info(f"Added client capabilities to remote agent message metadata: {client_capabilities}")
                        
        return request_payload, http_kwargs

class A2AClientFactoryWithA2UIMetadata(A2AClientFactory):
    @override
    def create(
        self,
        card: AgentCard,
        consumers: list[Consumer] | None = None,
        interceptors: list[ClientCallInterceptor] | None = None,
    ) -> Client:
        # Add A2UI metadata interceptor
        return super().create(card, consumers, (interceptors or []) + [A2UIMetadataInterceptor()])

class OrchestratorAgent:
    """An agent that runs an ecommerce dashboard"""

    SUPPORTED_CONTENT_TYPES = ["text", "text/plain"]
    
    @classmethod
    async def programmtically_route_user_action_to_subagent(
        cls,
        callback_context: CallbackContext,
        llm_request: LlmRequest,
    ) -> LlmResponse:
        if (
            llm_request.contents
            and (last_content := llm_request.contents[-1]).parts
            and (a2a_part := part_converters.convert_genai_part_to_a2a_part(last_content.parts[-1]))
            and is_a2ui_part(a2a_part)
            and (user_action := a2a_part.root.data.get("userAction"))
            and (surface_id := user_action.get("surfaceId"))
            and (target_agent := await SubagentRouteManager.get_route_to_subagent_name(surface_id, callback_context.state))
        ):
            logger.info(f"Programmatically routing userAction for surfaceId '{surface_id}' to subagent '{target_agent}'")
            return LlmResponse(
                content=genai_types.Content(
                    parts=[
                        genai_types.Part(
                            function_call=genai_types.FunctionCall(
                                name="transfer_to_agent",
                                args={"agent_name": target_agent},
                            )
                        )
                    ]
                )
            )
                     
        return None

    @classmethod
    async def build_agent(cls, subagent_urls: List[str]) -> LlmAgent:
        """Builds the LLM agent for the orchestrator_agent agent."""

        subagents = []
        for subagent_url in subagent_urls:
            async with httpx.AsyncClient() as httpx_client:
                resolver = A2ACardResolver(
                    httpx_client=httpx_client,
                    base_url=subagent_url,
                )
                
                subagent_card =  await resolver.get_agent_card()
                logger.info('Successfully fetched public agent card:' + subagent_card.model_dump_json(indent=2, exclude_none=True))
                
                # clean name for adk
                clean_name = re.sub(r'[^0-9a-zA-Z_]+', '_', subagent_card.name)                
                if clean_name == "":
                    clean_name = "_"
                if clean_name[0].isdigit():
                    clean_name = f"_{clean_name}"
                
                # make remote agent
                description = json.dumps({
                    "id": clean_name,
                    "name": subagent_card.name,
                    "description": subagent_card.description,
                    "skills": [
                        {
                            "name": skill.name, 
                            "description": skill.description, 
                            "examples": skill.examples, 
                            "tags": skill.tags
                        } for skill in subagent_card.skills
                    ]
                }, indent=2)
                remote_a2a_agent = RemoteA2aAgent(
                    clean_name, 
                    subagent_card, 
                    description=description, # This will be appended to system instructions
                    a2a_part_converter=part_converters.convert_a2a_part_to_genai_part,
                    genai_part_converter=part_converters.convert_genai_part_to_a2a_part,                      
                    a2a_client_factory=A2AClientFactoryWithA2UIMetadata(
                        config=A2AClientConfig(
                            httpx_client=httpx.AsyncClient(
                                timeout=httpx.Timeout(timeout=DEFAULT_TIMEOUT),
                            ),
                            streaming=False,
                            polling=False,
                            supported_transports=[A2ATransport.jsonrpc],
                        )
                    )
                )
                subagents.append(remote_a2a_agent)
                
                logger.info(f'Created remote agent with description: {description}')

        LITELLM_MODEL = os.getenv("LITELLM_MODEL", "gemini/gemini-2.5-flash")
        return LlmAgent(
            model=LiteLlm(model=LITELLM_MODEL),
            name="orchestrator_agent",
            description="An agent that orchestrates requests to multiple other agents",
            instruction="You are an orchestrator agent. Your sole responsibility is to analyze the incoming user request, determine the user's intent, and route the task to exactly one of your expert subagents",
            tools=[],
            planner=BuiltInPlanner(
                thinking_config=genai_types.ThinkingConfig(
                    include_thoughts=True,
                )
            ),
            sub_agents=subagents,
            before_model_callback=cls.programmtically_route_user_action_to_subagent,
        )
