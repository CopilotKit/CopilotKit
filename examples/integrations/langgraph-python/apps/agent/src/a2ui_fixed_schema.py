"""
Fixed-schema A2UI tool: flight search results.

Schema is loaded from a JSON file (paste-able from a schema builder).
Only the data changes per invocation.
"""

from __future__ import annotations

from pathlib import Path

from copilotkit import a2ui
from langchain.tools import tool
from typing import TypedDict

SURFACE_ID = "flight-search-results"
FLIGHT_SCHEMA = a2ui.load_schema(Path(__file__).parent / "a2ui" / "schemas" / "flight_schema.json")
BOOKED_SCHEMA = a2ui.load_schema(Path(__file__).parent / "a2ui" / "schemas" / "booked_schema.json")


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
    """Search for flights and display the results as rich cards.

    Each flight must have: id, airline (e.g. "United Airlines"),
    airlineLogo (use Google favicon API: https://www.google.com/s2/favicons?domain={airline_domain}&sz=128
    e.g. "https://www.google.com/s2/favicons?domain=united.com&sz=128" for United,
    "https://www.google.com/s2/favicons?domain=delta.com&sz=128" for Delta,
    "https://www.google.com/s2/favicons?domain=aa.com&sz=128" for American,
    "https://www.google.com/s2/favicons?domain=alaskaair.com&sz=128" for Alaska),
    flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" — use near-future dates),
    departureTime, arrivalTime,
    duration (e.g. "4h 25m"), status (e.g. "On Time" or "Delayed"),
    statusIcon (colored dot: use "https://placehold.co/12/22c55e/22c55e.png"
    for On Time, "https://placehold.co/12/eab308/eab308.png" for Delayed,
    "https://placehold.co/12/ef4444/ef4444.png" for Cancelled),
    and price (e.g. "$289").
    """
    return a2ui.render(
        operations=[
            a2ui.surface_update(SURFACE_ID, FLIGHT_SCHEMA),
            a2ui.data_model_update(SURFACE_ID, {"flights": flights}),
            a2ui.begin_rendering(SURFACE_ID, "root"),
        ],
        action_handlers={
            "book_flight": [
                a2ui.surface_update(SURFACE_ID, BOOKED_SCHEMA),
                a2ui.data_model_update(SURFACE_ID, {
                    "title": "Booking Confirmed",
                    "detail": "Your flight has been booked successfully.",
                    "reference": "CK-74921",
                }),
                a2ui.begin_rendering(SURFACE_ID, "root"),
            ],
        },
    )
