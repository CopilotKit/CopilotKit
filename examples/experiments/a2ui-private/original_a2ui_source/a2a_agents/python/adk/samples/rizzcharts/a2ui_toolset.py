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
import jsonschema
import logging
from typing import Any, List, Optional

from google.genai import types as genai_types

from google.adk.models import LlmRequest
from google.adk.tools.base_tool import BaseTool
from google.adk.tools import base_toolset
from google.adk.tools.tool_context import ToolContext
from google.adk.agents.readonly_context import ReadonlyContext
from a2ui_session_util import A2UI_ENABLED_STATE_KEY, A2UI_SCHEMA_STATE_KEY

logger = logging.getLogger(__name__)


class A2uiToolset(base_toolset.BaseToolset):
    """A toolset that provides A2UI Tools and can be enabled/disabled."""

    def __init__(self):
        super().__init__()
        self._ui_tools = [SendA2uiJsonToClientTool()]

    async def get_tools(
        self,
        readonly_context: Optional[ReadonlyContext] = None,
    ) -> List[BaseTool]:
        use_ui = readonly_context and readonly_context.state.get(A2UI_ENABLED_STATE_KEY)
        if use_ui:
            logger.info("A2UI is ENABLED, adding ui tools")
            return self._ui_tools
        else:
            logger.info("A2UI is DISABLED, not adding ui tools")
            return []


class SendA2uiJsonToClientTool(BaseTool):
    TOOL_NAME = "send_a2ui_json_to_client"
    A2UI_JSON_ARG_NAME = "a2ui_json"

    def __init__(self):
        super().__init__(
            name=self.TOOL_NAME,
            description="Sends A2UI JSON to the client to render rich UI for the user. This tool can be called multiple times in the same call to render multiple UI surfaces."
            "Args:"
            f"    {self.A2UI_JSON_ARG_NAME}: Valid A2UI JSON Schema to send to the client. The A2UI JSON Schema definition is between ---BEGIN A2UI JSON SCHEMA--- and ---END A2UI JSON SCHEMA--- in the system instructions.",
        )

    def _get_declaration(self) -> genai_types.FunctionDeclaration | None:
        return genai_types.FunctionDeclaration(
            name=self.name,
            description=self.description,
            parameters=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                properties={
                    self.A2UI_JSON_ARG_NAME: genai_types.Schema(
                        type=genai_types.Type.STRING,
                        description="valid A2UI JSON Schema to send to the client.",
                    ),
                },
                required=[self.A2UI_JSON_ARG_NAME],
            ),
        )

    def get_a2ui_schema(self, tool_context: ToolContext) -> dict[str, Any]:
        a2ui_schema = tool_context.state.get(A2UI_SCHEMA_STATE_KEY)
        if not a2ui_schema:
            raise ValueError("A2UI schema is empty")
        a2ui_schema_object = {"type": "array", "items": a2ui_schema} # Make a list since we support multiple parts in this tool call
        return a2ui_schema_object 

    async def process_llm_request(
        self, *, tool_context: ToolContext, llm_request: LlmRequest
    ) -> None:
        await super().process_llm_request(
            tool_context=tool_context, llm_request=llm_request
        )

        a2ui_schema = self.get_a2ui_schema(tool_context)

        llm_request.append_instructions(
            [
                f"""    
---BEGIN A2UI JSON SCHEMA---
{json.dumps(a2ui_schema)}
---END A2UI JSON SCHEMA---
"""
            ]
        )

        logger.info("Added a2ui_schema to system instructions")

    async def run_async(
        self, *, args: dict[str, Any], tool_context: ToolContext
    ) -> Any:
        try:
            a2ui_json = args.get(self.A2UI_JSON_ARG_NAME)
            if not a2ui_json:                
                raise ValueError(
                    f"Failed to call tool {self.TOOL_NAME} because missing required arg {self.A2UI_JSON_ARG_NAME} "
                )

            a2ui_json_payload = json.loads(a2ui_json)
            a2ui_schema = self.get_a2ui_schema(tool_context)
            jsonschema.validate(
                instance=a2ui_json_payload, schema=a2ui_schema
            )

            logger.info(
                f"Validated call to tool {self.TOOL_NAME} with {self.A2UI_JSON_ARG_NAME}"
            )

            # Don't do a second LLM inference call for the None response
            tool_context.actions.skip_summarization = True

            return None
        except Exception as e:
            err = f"Failed to call A2UI tool {self.TOOL_NAME}: {e}"
            logger.error(err)

            return {"error": err}
