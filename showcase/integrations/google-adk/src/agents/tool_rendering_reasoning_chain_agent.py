"""Agent backing the `tool-rendering-reasoning-chain` demo.

Same tool surface as the other tool-rendering variants (minus `roll_d20`
plus `roll_dice` — the reasoning-chain pills script a d20 → d6 contrast
via the sides parameter), plus Gemini 2.5 thinking mode so reasoning
tokens are interleaved with sequential tool calls (the demo's frontend
renders the thought trace alongside each tool result).
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.genai import types

from agents.shared_chat import get_model, stop_on_terminal_text
from agents.tool_rendering_common import (
    TOOL_RENDERING_REASONING_CHAIN_INSTRUCTION,
    get_stock_price,
    get_weather,
    roll_dice,
    search_flights,
)

tool_rendering_reasoning_chain_agent = LlmAgent(
    name="ToolRenderingReasoningChainAgent",
    model=get_model(),
    instruction=TOOL_RENDERING_REASONING_CHAIN_INSTRUCTION,
    tools=[get_weather, search_flights, get_stock_price, roll_dice],
    generate_content_config=types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(
            include_thoughts=True,
            thinking_budget=-1,
        ),
    ),
    after_model_callback=stop_on_terminal_text,
)
