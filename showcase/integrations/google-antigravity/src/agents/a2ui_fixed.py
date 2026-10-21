"""A2UI fixed schema: the component tree is authored ahead of time as JSON.

``display_flight`` is a server tool, so the adapter streams its return value
as ``TOOL_CALL_RESULT``. That value is an ``a2ui_operations`` container; the
runtime's A2UI middleware detects it and forwards the surface to the page's
catalog. Operations use the v0.9 nested shape, as in google-adk's
``a2ui_fixed_agent.py`` (this package has no ``copilotkit`` Python SDK, so
``a2ui.render(...)`` is spelled out by hand).

No ``from __future__ import annotations``: the SDK derives the tool schema
from the live annotations.
"""

# @region[backend-render-operations]
# @region[backend-schema-json-load]
import json
from pathlib import Path
from typing import Any

from agents._common import build

CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"

with open(_SCHEMAS_DIR / "flight_schema.json", encoding="utf-8") as _f:
    FLIGHT_SCHEMA: list[dict[str, Any]] = json.load(_f)
# @endregion[backend-schema-json-load]


def display_flight(origin: str, destination: str, airline: str, price: str) -> dict:
    """Show a flight card for the given trip.

    Use short airport codes (e.g. "SFO", "JFK") for origin/destination and a
    price string like "$289".

    After this tool returns, the flight card is already rendered to the user
    via the A2UI surface — the JSON returned here is the surface descriptor
    the renderer consumes, NOT a status code. Do NOT call this tool again
    for the same flight (the user already sees the card). Reply with one
    short confirmation sentence and stop.
    """
    return {
        "a2ui_operations": [
            {
                "version": "v0.9",
                "createSurface": {"surfaceId": SURFACE_ID, "catalogId": CATALOG_ID},
            },
            {
                "version": "v0.9",
                "updateComponents": {
                    "surfaceId": SURFACE_ID,
                    "components": FLIGHT_SCHEMA,
                },
            },
            {
                "version": "v0.9",
                "updateDataModel": {
                    "surfaceId": SURFACE_ID,
                    "path": "/",
                    "value": {
                        "origin": origin,
                        "destination": destination,
                        "airline": airline,
                        "price": price,
                    },
                },
            },
        ]
    }


# @endregion[backend-render-operations]

SYSTEM_PROMPT = (
    "You help users find flights. When asked about a flight, call "
    "`display_flight` exactly ONCE with origin, destination, airline, "
    "and price. The tool's JSON return value is an A2UI surface "
    "descriptor — the flight card is already rendered to the user; do "
    "NOT call `display_flight` again for the same trip. After the tool "
    "returns, reply with one short confirmation sentence and stop."
)


def a2ui_fixed_agent():
    return build(system_instructions=SYSTEM_PROMPT, tools=[display_flight])
