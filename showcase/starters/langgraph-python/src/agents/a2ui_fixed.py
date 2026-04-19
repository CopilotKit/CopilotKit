"""
LangGraph agent for the Declarative Generative UI (A2UI — Fixed Schema) demo.

Demonstrates fixed-schema A2UI: the component tree (schema) lives on the
frontend (see `app/demos/a2ui-fixed-schema/page.tsx`). The agent emits A2UI
operations that only carry *data* matching that fixed shape — here, a flight
card with { origin, destination, airline, price }.
"""

from __future__ import annotations

from typing import TypedDict

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_openai import ChatOpenAI

CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

# A fixed component tree. This mirrors the catalog the frontend registers.
# The agent only controls *data* via the data model below. Each prop is a
# top-level key on the component (A2UI v0.9 wire format); the path bindings
# tell the renderer to pull the value from the data model.
FIXED_SCHEMA = [
    {
        "id": "root",
        "component": "FlightCard",
        "origin": {"path": "/origin"},
        "destination": {"path": "/destination"},
        "airline": {"path": "/airline"},
        "price": {"path": "/price"},
    }
]

class Flight(TypedDict):
    origin: str
    destination: str
    airline: str
    price: str

@tool
def search_flight(origin: str, destination: str, airline: str, price: str) -> str:
    """Show a flight card for the given trip. Use short airport codes (e.g. "SFO", "JFK")."""
    return a2ui.render(
        operations=[
            a2ui.create_surface(SURFACE_ID, catalog_id=CATALOG_ID),
            a2ui.update_components(SURFACE_ID, FIXED_SCHEMA),
            a2ui.update_data_model(
                SURFACE_ID,
                {
                    "origin": origin,
                    "destination": destination,
                    "airline": airline,
                    "price": price,
                },
            ),
        ],
    )

graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[search_flight],
    middleware=[CopilotKitMiddleware()],
    system_prompt=(
        "You help users find flights. When asked about a flight, call "
        "search_flight with origin, destination, airline, and price. "
        "Keep any chat reply to one short sentence."
    ),
)
