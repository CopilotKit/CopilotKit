"""Agents backing the tool-rendering demo family.

All four variants share the same set of backend tools (get_weather +
search_flights), since the differences are entirely on the frontend:

- tool-rendering: per-tool custom renderers (WeatherCard, FlightListCard)
  plus a wildcard catch-all.
- tool-rendering-default-catchall: zero custom renderers; relies on
  CopilotKit's built-in default tool UI.
- tool-rendering-custom-catchall: a single branded catch-all renderer
  registered via useDefaultRenderTool — paints every tool call.
- tool-rendering-reasoning-chain: same tools, plus Gemini thinking enabled
  so reasoning is interleaved with sequential tool calls.
"""

from __future__ import annotations

import os

from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext
from google.genai import types

# Pull shared sales-pipeline tool implementations from showcase/shared/python.
from .tools import (  # noqa: E402
    get_weather_impl,
    search_flights_impl,
    query_data_impl,
)

def get_weather(tool_context: ToolContext, location: str) -> dict:
    """Get the weather for a given location."""
    return get_weather_impl(location)

def search_flights(tool_context: ToolContext, flights: list[dict]) -> dict:
    """Search for flights and return 2-3 candidate cards.

    Each flight dict needs: airline, airlineLogo, flightNumber, origin,
    destination, date, departureTime, arrivalTime, duration, status,
    statusColor, price, currency. For airlineLogo use Google's favicon API:
    https://www.google.com/s2/favicons?domain={airline_domain}&sz=128
    """
    return search_flights_impl(flights)

def query_data(tool_context: ToolContext, query: str) -> list:
    """Query financial data — returns rows suitable for a pie or bar chart."""
    return query_data_impl(query)

_TOOL_INSTRUCTION = (
    "You are a helpful assistant. Call get_weather when the user asks about "
    "the weather. Call search_flights to find flights — return 2-3 plausible "
    "options with realistic-looking metadata. Call query_data when the user "
    "asks for financial charts. Always provide a brief textual summary after "
    "any tool call."
)

def _build(name: str, *, thinking: bool = False) -> LlmAgent:
    kwargs = {
        "name": name,
        "model": "gemini-2.5-flash",
        "instruction": _TOOL_INSTRUCTION,
        "tools": [get_weather, search_flights, query_data],
    }
    if thinking:
        kwargs["generate_content_config"] = types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                include_thoughts=True,
                thinking_budget=-1,
            ),
        )
    return LlmAgent(**kwargs)

tool_rendering_agent = _build("ToolRenderingAgent")
tool_rendering_default_catchall_agent = _build("ToolRenderingDefaultCatchallAgent")
tool_rendering_custom_catchall_agent = _build("ToolRenderingCustomCatchallAgent")
tool_rendering_reasoning_chain_agent = _build(
    "ToolRenderingReasoningChainAgent", thinking=True
)
