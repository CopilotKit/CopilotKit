"""Agent backing the `tool-rendering-default-catchall` demo.

Out-of-the-box tool rendering — backend defines the tools; the frontend
adds zero custom renderers and relies on CopilotKit's built-in default UI.
Backend tool surface matches the other tool-rendering variants — see
tool_rendering_common.py.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent

from agents.tool_rendering_common import (
    TOOL_RENDERING_INSTRUCTION,
    get_weather,
    query_data,
    search_flights,
)

tool_rendering_default_catchall_agent = LlmAgent(
    name="ToolRenderingDefaultCatchallAgent",
    model="gemini-2.5-flash",
    instruction=TOOL_RENDERING_INSTRUCTION,
    tools=[get_weather, search_flights, query_data],
)
