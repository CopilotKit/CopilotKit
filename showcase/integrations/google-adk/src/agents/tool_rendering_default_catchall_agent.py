"""Agent backing the `tool-rendering-default-catchall` demo.

Out-of-the-box tool rendering — backend defines the tools; the frontend
adds zero custom renderers and relies on CopilotKit's built-in default UI.
Backend tool surface matches the other tool-rendering variants — see
tool_rendering_common.py.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent

from agents.shared_chat import get_model, stop_on_terminal_text
from agents.tool_rendering_common import (
    TOOL_RENDERING_INSTRUCTION,
    get_stock_price,
    get_weather,
    roll_d20,
    search_flights,
)

tool_rendering_default_catchall_agent = LlmAgent(
    name="ToolRenderingDefaultCatchallAgent",
    model=get_model(),
    instruction=TOOL_RENDERING_INSTRUCTION,
    tools=[get_weather, search_flights, get_stock_price, roll_d20],
    after_model_callback=stop_on_terminal_text,
)
