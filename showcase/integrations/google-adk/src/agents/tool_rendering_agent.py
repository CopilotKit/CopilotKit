"""Agent backing the `tool-rendering` demo.

Custom per-tool renderers (WeatherCard, FlightListCard) plus a wildcard
catch-all on the frontend. Backend tools are identical across all four
tool-rendering variants — see tool_rendering_common.py.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent

from agents.tool_rendering_common import (
    TOOL_RENDERING_INSTRUCTION,
    get_weather,
    query_data,
    search_flights,
)

tool_rendering_agent = LlmAgent(
    name="ToolRenderingAgent",
    model="gemini-2.5-flash",
    instruction=TOOL_RENDERING_INSTRUCTION,
    tools=[get_weather, search_flights, query_data],
)
