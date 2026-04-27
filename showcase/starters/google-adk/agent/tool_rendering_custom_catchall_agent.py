"""Agent backing the `tool-rendering-custom-catchall` demo.

Single branded wildcard renderer registered via useDefaultRenderTool on
the frontend — same backend tool surface as every other tool-rendering
variant.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent

from .tool_rendering_common import (
    TOOL_RENDERING_INSTRUCTION,
    get_weather,
    query_data,
    search_flights,
)

tool_rendering_custom_catchall_agent = LlmAgent(
    name="ToolRenderingCustomCatchallAgent",
    model="gemini-2.5-flash",
    instruction=TOOL_RENDERING_INSTRUCTION,
    tools=[get_weather, search_flights, query_data],
)
