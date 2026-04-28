"""Agent backing the `tool-rendering-reasoning-chain` demo.

Same tool surface as the other tool-rendering variants, plus Gemini 2.5
thinking mode so reasoning tokens are interleaved with sequential tool
calls (the demo's frontend renders the thought trace alongside each tool
result).
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.genai import types

from agents.tool_rendering_common import (
    TOOL_RENDERING_INSTRUCTION,
    get_weather,
    query_data,
    search_flights,
)

tool_rendering_reasoning_chain_agent = LlmAgent(
    name="ToolRenderingReasoningChainAgent",
    model="gemini-2.5-flash",
    instruction=TOOL_RENDERING_INSTRUCTION,
    tools=[get_weather, search_flights, query_data],
    generate_content_config=types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(
            include_thoughts=True,
            thinking_budget=-1,
        ),
    ),
)
