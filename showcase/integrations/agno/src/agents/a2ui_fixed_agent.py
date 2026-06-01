"""Agno agent for the Declarative Generative UI (A2UI Fixed Schema) demo.

Fixed-schema A2UI: the component tree (schema) is authored ahead of time
as JSON and shipped with the backend. The agent only streams *data* into
the data model at runtime via the `display_flight` tool. The frontend
registers a matching catalog (see
`src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts`).

Mirrors the langgraph-python `a2ui_fixed.py` reference. The dedicated
runtime route at `api/copilotkit-a2ui-fixed-schema/route.ts` runs the
A2UI middleware with `injectA2UITool: false` because the backend owns
the rendering tool itself — it emits an `a2ui_operations` container
directly without a secondary LLM call.
"""

from __future__ import annotations

import json
from pathlib import Path

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools import tool
from dotenv import load_dotenv

load_dotenv()


CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"


def _load_schema(filename: str) -> list[dict]:
    """Load an A2UI fixed schema from the local schemas directory."""
    with open(_SCHEMAS_DIR / filename, "r", encoding="utf-8") as fh:
        return json.load(fh)


FLIGHT_SCHEMA = _load_schema("flight_schema.json")
# `booked_schema.json` is shipped alongside `flight_schema.json` so the
# schema is ready to wire up once the SDK exposes per-button action handlers
# for fixed-schema surfaces (matching the langgraph-python reference).
BOOKED_SCHEMA = _load_schema("booked_schema.json")


@tool
def display_flight(origin: str, destination: str, airline: str, price: str):
    """Show a flight card for the given trip.

    Emits an `a2ui_operations` container directly — NO secondary LLM
    call. The runtime A2UI middleware detects the container in the tool
    result and forwards the surface to the frontend renderer. The
    frontend catalog resolves component names against the local React
    components.

    Args:
        origin (str): Origin airport code (e.g. "SFO").
        destination (str): Destination airport code (e.g. "JFK").
        airline (str): Airline name (e.g. "United").
        price (str): Price string (e.g. "$289").

    Returns:
        str: A2UI operations as JSON.
    """
    operations = [
        {
            "type": "create_surface",
            "surfaceId": SURFACE_ID,
            "catalogId": CATALOG_ID,
        },
        {
            "type": "update_components",
            "surfaceId": SURFACE_ID,
            "components": FLIGHT_SCHEMA,
        },
        {
            "type": "update_data_model",
            "surfaceId": SURFACE_ID,
            "data": {
                "origin": origin,
                "destination": destination,
                "airline": airline,
                "price": price,
            },
        },
    ]
    return json.dumps({"a2ui_operations": operations})


SYSTEM_PROMPT = (
    "You help users find flights. When asked about a flight, call "
    "display_flight with origin (3-letter code), destination (3-letter "
    "code), airline, and price (e.g. '$289'). Keep any chat reply to one "
    "short sentence."
)


agent = Agent(
    model=OpenAIChat(id="gpt-4o-mini", timeout=120),
    tools=[display_flight],
    tool_call_limit=4,
    description=SYSTEM_PROMPT,
)
