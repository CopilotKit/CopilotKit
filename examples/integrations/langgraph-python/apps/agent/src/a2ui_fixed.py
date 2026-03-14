"""
Fixed-schema A2UI tool: flight search results.

Schema is loaded from a JSON file (paste-able from a schema builder).
Only the data changes per invocation.
"""

from __future__ import annotations

from pathlib import Path

from langchain.tools import tool
from typing_extensions import TypedDict

from src.a2ui import a2ui_surface, load_schema

SURFACE_ID = "flight-search-results"
FLIGHT_SCHEMA = load_schema(Path(__file__).parent / "a2ui_flight_schema.json")


class Flight(TypedDict):
    id: str
    origin: str
    destination: str
    date: str
    departureTime: str
    arrivalTime: str
    status: str
    flightNumber: str


@tool
def search_flights(flights: list[Flight]) -> str:
    """Search for flights and display the results as rich cards.

    Each flight must have: id, origin, destination, date,
    departureTime, arrivalTime, status, and flightNumber.
    """
    return a2ui_surface(
        surface_id=SURFACE_ID,
        root="root",
        components=FLIGHT_SCHEMA,
        data={"flights": flights},
    )
