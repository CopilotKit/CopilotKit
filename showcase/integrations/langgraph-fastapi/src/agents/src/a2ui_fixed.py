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

# @region[backend-schema-json-load]
# Schemas are JSON so they can be authored and reviewed independently of the
# Python code. `a2ui.load_schema` is just a thin `json.load` wrapper.
FLIGHT_SCHEMA = a2ui.load_schema(_SCHEMAS_DIR / "flight_schema.json")
BOOKED_SCHEMA = a2ui.load_schema(_SCHEMAS_DIR / "booked_schema.json")
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
    """
    # @region[backend-render-operations]
    # The A2UI middleware detects the `a2ui_operations` container in this
    # tool result and forwards the ops to the frontend renderer. The frontend
    # catalog resolves component names to the local React components.
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
        # NOTE: The canonical reference (and the docs at
        # docs/integrations/langgraph/generative-ui/a2ui/fixed-schema.mdx)
        # also pass `action_handlers={...}` here to declare optimistic UI
        # transitions — e.g. swapping to BOOKED_SCHEMA when the card's
        # `book_flight` button is clicked. The Python SDK's `a2ui.render`
        # does not yet accept that kwarg (see sdk-python/copilotkit/a2ui.py),
        # so we omit it for now. The `booked_schema.json` sibling is kept
        # so the schema is ready to wire up once the SDK exposes handlers.
    )
    # @endregion[backend-render-operations]


graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[display_flight],
    middleware=[CopilotKitMiddleware()],
    system_prompt=(
        "You help users find flights. When asked about a flight, call "
        "display_flight with origin, destination, airline, and price. "
        "Keep any chat reply to one short sentence."
    ),
)
