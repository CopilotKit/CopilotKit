"""Agent backing the A2UI Fixed-Schema demo.

The component tree is authored ahead of time as JSON (see a2ui_schemas/) and
the agent's `display_flight` tool emits an a2ui_operations container whose
ops apply the schema and seed the data model. The runtime detects the
container in the tool result and forwards surfaces to the frontend renderer.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"


def _load_schema(name: str) -> list[dict[str, Any]]:
    with open(_SCHEMAS_DIR / name, "r", encoding="utf-8") as f:
        return json.load(f)


FLIGHT_SCHEMA = _load_schema("flight_schema.json")
# Loaded for parity with the langgraph-python sibling; the A2UI Python SDK's
# `a2ui.render(...)` does not yet accept the `action_handlers={...}` kwarg
# that would let `display_flight` swap to BOOKED_SCHEMA on the bookButton
# action, so the schema sits read-only here. See langgraph-python's
# `a2ui_fixed.py` for the canonical reference.
BOOKED_SCHEMA = _load_schema("booked_schema.json")  # noqa: F841


def _build_flight_operations(
    *, origin: str, destination: str, airline: str, price: str
) -> dict[str, Any]:
    """Build the v0.9 a2ui_operations container the runtime detects."""
    return {
        "a2ui_operations": [
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
    }


def display_flight(
    tool_context: ToolContext,
    origin: str,
    destination: str,
    airline: str,
    price: str,
) -> dict[str, Any]:
    """Show a flight card for the given trip.

    Use short airport codes (e.g. "SFO", "JFK") for origin/destination and a
    price string like "$289".
    """
    return _build_flight_operations(
        origin=origin, destination=destination, airline=airline, price=price
    )


_INSTRUCTION = (
    "You help users find flights. When asked about a flight, call "
    "display_flight with origin, destination, airline, and price. Keep any "
    "chat reply to one short sentence."
)

a2ui_fixed_agent = LlmAgent(
    name="A2uiFixedAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[display_flight],
)
