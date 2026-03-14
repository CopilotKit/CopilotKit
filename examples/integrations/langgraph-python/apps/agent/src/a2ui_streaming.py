"""
Streaming A2UI tool: flight search with progressive rendering.

Unlike the fixed-schema tool (a2ui_fixed.py), this tool does NOT emit
A2UI operations itself. Instead:
  1. The schema is registered on the middleware config (TypeScript side)
  2. The middleware emits surfaceUpdate + beginRendering on TOOL_CALL_START
  3. As the LLM streams flight data (tool args), the middleware partial-parses
     and emits dataModelUpdate progressively
  4. Flight cards appear one by one as the LLM generates them

The tool function just confirms completion — all A2UI rendering is handled
by the middleware.
"""

from __future__ import annotations

from typing import Literal

from langchain_core.tools import StructuredTool
from typing_extensions import TypedDict


class Flight(TypedDict):
    id: str
    origin: str
    destination: str
    date: str
    departureTime: str
    arrivalTime: str
    status: str
    flightNumber: str


def _search_flights_streaming(flights: list[Flight]) -> str:
    """Search for flights and display results with streaming A2UI rendering.

    Each flight must have: id, origin, destination, date,
    departureTime, arrivalTime, status, and flightNumber.

    The A2UI middleware renders flight cards progressively as each
    flight is generated.
    """
    return f"Displayed {len(flights)} flights."


search_flights_streaming = StructuredTool.from_function(
    func=_search_flights_streaming,
    name="search_flights_streaming",
    description=(
        "Search for flights and display results with streaming A2UI rendering. "
        "Each flight must have: id, origin, destination, date, "
        "departureTime, arrivalTime, status, and flightNumber."
    ),
)
