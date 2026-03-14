"""
Fixed-schema A2UI tool: flight search results.

The schema (component template) is fixed — same every call.
Only the data changes per invocation.
"""

from __future__ import annotations

from typing import Literal

from langchain.tools import tool
from typing_extensions import TypedDict

from src.a2ui import a2ui_surface
from src.a2ui_flight_schema import FLIGHT_SCHEMA, SURFACE_ID


class Flight(TypedDict):
    id: str
    origin: str
    destination: str
    duration: str
    departure: str
    arrival: str
    airline: str
    flightNumber: str
    price: str


@tool
def search_flights(flights: list[Flight]) -> str:
    """Search for flights and display the results as rich cards.

    Each flight must have: id, origin, destination, duration,
    departure, arrival, airline, flightNumber, and price.
    """
    return a2ui_surface(
        surface_id=SURFACE_ID,
        root="root",
        components=FLIGHT_SCHEMA,
        data={"flights": flights},
    )
