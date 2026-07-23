"""Fixed-schema A2UI tool: flight search results.

Schema is loaded from a JSON file. Only the data changes per invocation.
"""

from pathlib import Path
from typing import List

from copilotkit import a2ui
from pydantic import BaseModel
from strands import tool

CATALOG_ID = "copilotkit://app-dashboard-catalog"
SURFACE_ID = "flight-search-results"
FLIGHT_SCHEMA = a2ui.load_schema(
    Path(__file__).parent / "a2ui" / "schemas" / "flight_schema.json"
)


class Flight(BaseModel):
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
def search_flights(flights: List[Flight]) -> str:
    """Search for flights and display the results as rich cards.

    Return exactly 2 flights. Each flight must have: id, airline (e.g.
    "United Airlines"), airlineLogo (Google favicon API URL like
    "https://www.google.com/s2/favicons?domain=united.com&sz=128"),
    flightNumber, origin, destination, date (e.g. "Tue, Mar 18" — use
    near-future dates), departureTime, arrivalTime, duration (e.g.
    "4h 25m"), status (e.g. "On Time" or "Delayed"), statusIcon (colored
    dot URL: https://placehold.co/12/22c55e/22c55e.png for On Time,
    https://placehold.co/12/eab308/eab308.png for Delayed,
    https://placehold.co/12/ef4444/ef4444.png for Cancelled), and price
    (e.g. "$289").
    """
    # Strands @tool passes plain dicts to the function body, so ``flights``
    # is a list of dicts here. Validate to enforce the schema, then dump
    # for a2ui rendering.
    flights_payload = [Flight.model_validate(f).model_dump() for f in flights]
    return a2ui.render(
        operations=[
            a2ui.create_surface(SURFACE_ID, catalog_id=CATALOG_ID),
            a2ui.update_components(SURFACE_ID, FLIGHT_SCHEMA),
            a2ui.update_data_model(SURFACE_ID, {"flights": flights_payload}),
        ],
    )
