"""
Fixed-schema A2UI tool: flight search results.
"""

from __future__ import annotations

from pathlib import Path
from typing import TypedDict

from copilotkit import a2ui
from langchain.tools import tool

CATALOG_ID = "copilotkit://app-dashboard-catalog"
SURFACE_ID = "flight-search-results"
FLIGHT_SCHEMA = a2ui.load_schema(
    Path(__file__).parent / "a2ui" / "schemas" / "flight_schema.json"
)


class Flight(TypedDict):
    id: str
    airline: str
    airlineLogo: str
    flightNumber: str
    origin: str
    destination: str
    date: str
    departureTime: str
    arrivalTime: str
    duration: str
    status: str
    statusIcon: str
    price: str


@tool
def search_flights(flights: list[Flight]) -> str:
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: id, airline, airlineLogo, flightNumber, origin,
    destination, date, departureTime, arrivalTime, duration, status, statusIcon,
    and price.
    """
    return a2ui.render(
        operations=[
            a2ui.create_surface(SURFACE_ID, catalog_id=CATALOG_ID),
            a2ui.update_components(SURFACE_ID, FLIGHT_SCHEMA),
            a2ui.update_data_model(SURFACE_ID, {"flights": flights}),
        ],
    )
