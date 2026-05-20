"""Agent backing the `tool-rendering-custom-catchall` demo.

Single branded wildcard renderer registered via useDefaultRenderTool on
the frontend — same backend tool surface as every other tool-rendering
variant.
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

tool_rendering_custom_catchall_agent = LlmAgent(
    name="ToolRenderingCustomCatchallAgent",
    model=get_model(),
    instruction=TOOL_RENDERING_INSTRUCTION,
    tools=[get_weather, search_flights, get_stock_price, roll_d20],
    after_model_callback=stop_on_terminal_text,
)
