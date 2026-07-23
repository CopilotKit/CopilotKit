"""Fixed-schema A2UI tool — flight search results.

The A2UI component schema is loaded from JSON; only the flight data changes per
call. The tool result carries ``a2ui_operations``, which the frontend renders.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, TypedDict

from claude_agent_sdk import tool
from copilotkit import a2ui

CATALOG_ID = "copilotkit://app-dashboard-catalog"
FLIGHT_SURFACE_ID = "flight-search-results"
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


@tool(
    "search_flights",
    "Search for flights and display the results as rich cards. Return exactly 2 "
    "flights. Each flight must have: id, airline, airlineLogo (Google favicon API "
    "URL for the airline domain), flightNumber, origin, destination, date (e.g. "
    '"Tue, Mar 18" — use near-future dates), departureTime, arrivalTime, duration '
    '(e.g. "4h 25m"), status (e.g. "On Time" or "Delayed"), statusIcon (colored '
    "dot URL: https://placehold.co/12/22c55e/22c55e.png for On Time, "
    'https://placehold.co/12/eab308/eab308.png for Delayed), and price (e.g. "$289").',
    {"flights": list[Flight]},
)
async def search_flights(args: dict[str, Any]) -> dict[str, Any]:
    flights = args.get("flights", [])
    return {
        "content": [
            {
                "type": "text",
                "text": a2ui.render(
                    operations=[
                        a2ui.create_surface(FLIGHT_SURFACE_ID, catalog_id=CATALOG_ID),
                        a2ui.update_components(FLIGHT_SURFACE_ID, FLIGHT_SCHEMA),
                        a2ui.update_data_model(FLIGHT_SURFACE_ID, {"flights": flights}),
                    ]
                ),
            }
        ]
    }
