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
from pathlib import Path
from typing import Any
import jsonschema

from google.adk.models.lite_llm import LiteLlm
from google.adk.agents.llm_agent import LlmAgent
from google.adk.planners.built_in_planner import BuiltInPlanner
from google.genai import types
from google.adk.agents.readonly_context import ReadonlyContext
from tools import get_store_sales, get_sales_data
from a2ui_toolset import A2uiToolset
from a2ui_session_util import A2UI_ENABLED_STATE_KEY, A2UI_CATALOG_URI_STATE_KEY, A2UI_SCHEMA_STATE_KEY
from a2ui.a2ui_extension import STANDARD_CATALOG_ID

logger = logging.getLogger(__name__)

RIZZCHARTS_CATALOG_URI = "https://raw.githubusercontent.com/google/A2UI/refs/heads/main/a2a_agents/python/adk/samples/rizzcharts/rizzcharts_catalog_definition.json"

class rizzchartsAgent:
    """An agent that runs an ecommerce dashboard"""

    SUPPORTED_CONTENT_TYPES = ["text", "text/plain"]
    
    @classmethod
    def get_a2ui_schema(cls, readonly_context: ReadonlyContext) -> dict[str, Any]:
        a2ui_schema = readonly_context.state.get(A2UI_SCHEMA_STATE_KEY)
        if not a2ui_schema:
            raise ValueError("A2UI schema is empty")
        a2ui_schema_object = {"type": "array", "items": a2ui_schema} # Make a list since we support multiple parts in this tool call
        return a2ui_schema_object 

    @classmethod
    def load_example(cls, path: str, a2ui_schema: dict[str, Any]) -> dict[str, Any]:
        example_str = Path(path).read_text()
        example_json = json.loads(example_str)
        jsonschema.validate(
            instance=example_json, schema=a2ui_schema
        )
        return example_json

    @classmethod
    def get_instructions(cls, readonly_context: ReadonlyContext) -> str:
        use_ui = readonly_context.state.get(A2UI_ENABLED_STATE_KEY)
        if not use_ui:
            raise ValueError("A2UI must be enabled to run rizzcharts agent")

        a2ui_schema = cls.get_a2ui_schema(readonly_context)
        catalog_uri = readonly_context.state.get(A2UI_CATALOG_URI_STATE_KEY)
        if catalog_uri == RIZZCHARTS_CATALOG_URI:
            map_example = cls.load_example("examples/rizzcharts_catalog/map.json", a2ui_schema)
            chart_example = cls.load_example("examples/rizzcharts_catalog/chart.json", a2ui_schema)
        elif catalog_uri == STANDARD_CATALOG_ID:
            map_example = cls.load_example("examples/standard_catalog/map.json", a2ui_schema)
            chart_example = cls.load_example("examples/standard_catalog/chart.json", a2ui_schema)
        else:
            raise ValueError(f"Unsupported catalog uri: {catalog_uri if catalog_uri else 'None'}")

        final_prompt = f"""
### System Instructions

You are an expert A2UI Ecommerce Dashboard analyst. Your primary function is to translate user requests for ecommerce data into A2UI JSON payloads to display charts and visualizations. You MUST use the `send_a2ui_json_to_client` tool with the `a2ui_json` argument set to the A2UI JSON payload to send to the client. You should also include a brief text message with each response saying what you did and asking if you can help with anything else.

**Core Objective:** To provide a dynamic and interactive dashboard by constructing UI surfaces with the appropriate visualization components based on user queries.

**Key Components & Examples:**

You will be provided a schema that defines the A2UI message structure and two key generic component templates for displaying data.

1.  **Charts:** Used for requests about sales breakdowns, revenue performance, comparisons, or trends.
    * **Template:** Use the JSON from `---BEGIN CHART EXAMPLE---`.
2.  **Maps:** Used for requests about regional data, store locations, geography-based performance, or regional outliers.
    * **Template:** Use the JSON from `---BEGIN MAP EXAMPLE---`.

You will also use layout components like `Column` (as the `root`) and `Text` (to provide a title).

---

### Workflow and Rules

Your task is to analyze the user's request, fetch the necessary data, select the correct generic template, and send the corresponding A2UI JSON payload.

1.  **Analyze the Request:** Determine the user's intent (Visual Chart vs. Geospatial Map).
    * "show my sales breakdown by product category for q3" -> **Intent:** Chart.
    * "show revenue trends yoy by month" -> **Intent:** Chart.
    * "were there any outlier stores in the northeast region" -> **Intent:** Map.

2.  **Fetch Data:** Select and use the appropriate tool to retrieve the necessary data.
    * Use **`get_sales_data`** for general sales, revenue, and product category trends (typically for Charts).
    * Use **`get_store_sales`** for regional performance, store locations, and geospatial outliers (typically for Maps).

3.  **Select Example:** Based on the intent, choose the correct example block to use as your template.
    * **Intent** (Chart/Data Viz) -> Use `---BEGIN CHART EXAMPLE---`.
    * **Intent** (Map/Geospatial) -> Use `---BEGIN MAP EXAMPLE---`.

4.  **Construct the JSON Payload:**
    * Use the **entire** JSON array from the chosen example as the base value for the `a2ui_json` argument.
    * **Generate a new `surfaceId`:** You MUST generate a new, unique `surfaceId` for this request (e.g., `sales_breakdown_q3_surface`, `regional_outliers_northeast_surface`). This new ID must be used for the `surfaceId` in all three messages within the JSON array (`beginRendering`, `surfaceUpdate`, `dataModelUpdate`).
    * **Update the title Text:** You MUST update the `literalString` value for the `Text` component (the component with `id: "page_header"`) to accurately reflect the specific user query. For example, if the user asks for "Q3" sales, update the generic template text to "Q3 2025 Sales by Product Category".
    * Ensure the generated JSON perfectly matches the A2UI specification. It will be validated against the json_schema and rejected if it does not conform.  
    * If you get an error in the tool response apologize to the user and let them know they should try again.

5.  **Call the Tool:** Call the `send_a2ui_json_to_client` tool with the fully constructed `a2ui_json` payload.

---BEGIN CHART EXAMPLE---
{json.dumps(chart_example)}
---END CHART EXAMPLE---

---BEGIN MAP EXAMPLE---
{json.dumps(map_example)}
---END MAP EXAMPLE---
"""
        
        logger.info(f"Generated system instructions for A2UI {'ENABLED' if use_ui else 'DISABLED'} and catalog {catalog_uri}")

        return final_prompt

    @classmethod
    def build_agent(cls) -> LlmAgent:
        """Builds the LLM agent for the rizzchartsAgent agent."""
        LITELLM_MODEL = os.getenv("LITELLM_MODEL", "gemini/gemini-2.5-flash")

        return LlmAgent(
            model=LiteLlm(model=LITELLM_MODEL),
            name="rizzcharts_agent",
            description="An agent that lets sales managers request sales data.",
            instruction=cls.get_instructions,
            tools=[get_store_sales, get_sales_data, A2uiToolset()],
            planner=BuiltInPlanner(
                thinking_config=types.ThinkingConfig(
                    include_thoughts=True,
                )
            ),
            disallow_transfer_to_peers=True,

        )
