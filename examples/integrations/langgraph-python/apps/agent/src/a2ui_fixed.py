"""
Fixed-schema A2UI tool: flight search results.

Schema is loaded from a JSON file (paste-able from a schema builder).
Only the data changes per invocation.
"""

from __future__ import annotations

from pathlib import Path

from copilotkit import a2ui
from langchain.tools import tool
from typing_extensions import TypedDict

SURFACE_ID = "flight-search-results"
FLIGHT_SCHEMA = a2ui.load_schema(Path(__file__).parent / "a2ui_flight_schema.json")


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
    return a2ui.render([
        a2ui.surface_update(SURFACE_ID, FLIGHT_SCHEMA),
        a2ui.data_model_update(SURFACE_ID, {"flights": flights}),
        a2ui.begin_rendering(SURFACE_ID, "root"),
    ])
