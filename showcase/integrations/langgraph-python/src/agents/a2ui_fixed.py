"""
LangGraph agent for the Declarative Generative UI (A2UI — Fixed Schema) demo.

Fixed-schema A2UI: the component tree (schema) is authored ahead of time as
JSON and loaded at startup via `a2ui.load_schema(...)`. The agent only
streams *data* into the data model at runtime. The frontend registers a
matching catalog (see `src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts`)
that pins the schema's component names to real React implementations.

Reference:
    examples/integrations/langgraph-python/agent/src/a2ui_fixed_schema.py
"""

# @region[backend-render-operations]
# @region[backend-schema-json-load]
from __future__ import annotations

from pathlib import Path
from typing import TypedDict

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_openai import ChatOpenAI

CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"

# The schema is JSON so it can be authored and reviewed independently of the
# Python code. `a2ui.load_schema` is just a thin `json.load` wrapper.
FLIGHT_SCHEMA = a2ui.load_schema(_SCHEMAS_DIR / "flight_schema.json")
# @endregion[backend-schema-json-load]


class Flight(TypedDict):
    """Shape the LLM should fill in when calling `display_flight`.

    LangGraph serializes this TypedDict into the tool's JSON schema, so
    defining it narrowly is how we steer the LLM to produce data that fits
    the frontend `FlightCard` component's props.
    """

    origin: str
    destination: str
    airline: str
    price: str


@tool
def display_flight(origin: str, destination: str, airline: str, price: str) -> str:
    """Show a flight card for the given trip.

    Use short airport codes (e.g. "SFO", "JFK") for origin/destination and a
    price string like "$289".

    After this tool returns, the flight card is already rendered to the user
    via the A2UI surface — the JSON returned here is the surface descriptor
    the renderer consumes, NOT a status code. Do NOT call this tool again
    for the same flight (the user already sees the card). Reply with one
    short confirmation sentence and stop.
    """
    # The A2UI middleware detects the `a2ui_operations` container in this
    # tool result and forwards the ops to the frontend renderer. The frontend
    # catalog resolves component names to the local React components.
    #
    # Note: schema-swap-on-action (e.g. swapping to a "booked" schema when
    # the card's button is clicked) will be added once the Python SDK
    # exposes `action_handlers=` on `a2ui.render`.
    return a2ui.render(
        operations=[
            a2ui.create_surface(SURFACE_ID, catalog_id=CATALOG_ID),
            a2ui.update_components(SURFACE_ID, FLIGHT_SCHEMA),
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
    # @endregion[backend-render-operations]


graph = create_agent(
    model=ChatOpenAI(model="gpt-5.4"),
    tools=[display_flight],
    middleware=[CopilotKitMiddleware()],
    system_prompt=(
        "You help users find flights. When asked about a flight, call "
        "`display_flight` exactly ONCE with origin, destination, airline, "
        "and price. The tool's JSON return value is an A2UI surface "
        "descriptor — the flight card is already rendered to the user; do "
        "NOT call `display_flight` again for the same trip. After the tool "
        "returns, reply with one short confirmation sentence and stop."
    ),
)
