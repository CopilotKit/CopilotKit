"""Shared tool implementations used by every tool-rendering variant.

The four tool-rendering demos differ only in their frontend wiring; the
backend tool surface is identical. Pulled out so each per-variant agent
file can declare its own `tools=[...]` literal — that visibility is what
`scripts/validate-fixture-tool-surface.ts` relies on to detect aimock
fixture drift.
"""

from __future__ import annotations

import os
import sys

from google.adk.tools import ToolContext

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"
    ),
)
from tools import (  # noqa: E402
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


TOOL_RENDERING_INSTRUCTION = (
    "You are a helpful assistant. Call get_weather when the user asks about "
    "the weather. Call search_flights to find flights — return 2-3 plausible "
    "options with realistic-looking metadata. Call query_data when the user "
    "asks for financial charts. Always provide a brief textual summary after "
    "any tool call."
)
