"""
Fixed-schema A2UI tool: flight search results.

Schema is loaded from the shared frontend package's flight-schema.json.
"""

from __future__ import annotations

from src.agents.tool_wrappers import search_flights_impl
from src.agents.tools.types import Flight

from langchain_core.tools import tool

@tool
def search_flights(flights: list[Flight]) -> str:
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: airline, airlineLogo, flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" -- use near-future dates),
    departureTime, arrivalTime, duration (e.g. "4h 25m"),
    status (e.g. "On Time" or "Delayed"),
    statusColor (hex color for status dot),
    price (e.g. "$289"), and currency (e.g. "USD").

    For airlineLogo use Google favicon API:
    https://www.google.com/s2/favicons?domain={airline_domain}&sz=128
    """
    import json

    result = search_flights_impl(flights)
    return json.dumps(result)
