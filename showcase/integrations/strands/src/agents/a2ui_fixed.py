"""Dedicated Strands agent for the A2UI Fixed Schema demo.

Strands port of the canonical langgraph-python ``a2ui_fixed`` demo
(``../../../langgraph-python/src/agents/a2ui_fixed.py``). Unlike the dynamic
A2UI demo (which relies on the adapter auto-injecting ``generate_a2ui`` to
*generate* a surface), the fixed-schema demo wires a single plain backend
``@tool`` — ``display_flight`` — that returns the ``a2ui_operations`` envelope
(create_surface -> update_components -> update_data_model). The component tree
is fixed and authored ahead of time (``a2ui_schemas/flight_schema.json``); only
the *data* changes per call. The runtime's A2UIMiddleware detects the envelope
in the tool result and paints it. No sub-agent, no generation, no recovery
loop, no ``generate_a2ui`` injection.

The schema's component names + data paths match the showcase frontend catalog
at ``src/app/demos/a2ui-fixed-schema/a2ui/{definitions,renderers,catalog}.ts``
(catalog id ``copilotkit://flight-fixed-catalog``).

The tool returns the envelope as a JSON **string** (not a dict): the Strands
adapter reads the ``toolResult`` ``text`` block, ``json.loads`` it, then
``json.dumps`` it back into the ToolCallResult content the client's
A2UIMiddleware scans for ``a2ui_operations``. Returning a string is what lands
the payload in a ``text`` block (a bare dict may land in a ``json`` block the
adapter skips).

Envelope shape note: the ops use the A2UI v0.9 nested form
(``{"version": "v0.9", "createSurface": {...}}``) — identical to what the
``copilotkit`` Python SDK's ``a2ui.render(...)`` emits in the proven
langgraph-python showcase path. We build the dict by hand here because the
``ag_ui_a2ui_toolkit`` package is not a showcase dependency (it is only
importable from a local ag-ui checkout, not from requirements.txt).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from strands import Agent, tool
from ag_ui_strands import StrandsAgent

from agents.agent import _build_model

CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"

# The schema is JSON so it can be authored and reviewed independently of the
# Python code.
with open(_SCHEMAS_DIR / "flight_schema.json") as _f:
    FLIGHT_SCHEMA: list[dict[str, Any]] = json.load(_f)


def _create_surface(surface_id: str, catalog_id: str) -> dict[str, Any]:
    return {
        "version": "v0.9",
        "createSurface": {"surfaceId": surface_id, "catalogId": catalog_id},
    }


def _update_components(
    surface_id: str, components: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "version": "v0.9",
        "updateComponents": {"surfaceId": surface_id, "components": components},
    }


def _update_data_model(surface_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": "v0.9",
        "updateDataModel": {"surfaceId": surface_id, "path": "/", "value": data},
    }


def _envelope(data: dict[str, Any]) -> str:
    """Build the A2UI operations envelope as a JSON string.

    Returned as a string so the Strands adapter emits it in a ``text`` block
    the client A2UIMiddleware can detect.
    """
    return json.dumps(
        {
            "a2ui_operations": [
                _create_surface(SURFACE_ID, CATALOG_ID),
                _update_components(SURFACE_ID, FLIGHT_SCHEMA),
                _update_data_model(SURFACE_ID, data),
            ]
        }
    )


@tool
def display_flight(origin: str, destination: str, airline: str, price: str) -> str:
    """Show a flight card for the given trip.

    Use short airport codes (e.g. "SFO", "JFK") for origin/destination and a
    price string like "$289".

    After this tool returns, the flight card is already rendered to the user
    via the A2UI surface — the JSON returned here is the surface descriptor
    the renderer consumes, NOT a status code. Do NOT call this tool again for
    the same flight (the user already sees the card). Reply with one short
    confirmation sentence and stop.

    Args:
        origin: Origin airport code, e.g. "SFO".
        destination: Destination airport code, e.g. "JFK".
        airline: Airline name, e.g. "United".
        price: Price string, e.g. "$289".
    """
    return _envelope(
        {
            "origin": origin,
            "destination": destination,
            "airline": airline,
            "price": price,
        }
    )


SYSTEM_PROMPT = (
    "You help users find flights. When asked about a flight, call "
    "`display_flight` exactly ONCE with origin, destination, airline, and "
    "price. The tool's JSON return value is an A2UI surface descriptor — the "
    "flight card is already rendered to the user; do NOT call `display_flight` "
    "again for the same trip and do NOT repeat the flight details in text. "
    "After the tool returns, reply with one short confirmation sentence and "
    "stop."
)


def build_a2ui_fixed_schema_agent() -> StrandsAgent:
    """Construct the dedicated A2UI fixed-schema StrandsAgent."""
    strands_agent = Agent(
        model=_build_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=[display_flight],
    )

    return StrandsAgent(
        agent=strands_agent,
        name="a2ui_fixed_schema",
        description="A2UI surface from a fixed, pre-authored schema (direct backend tool)",
    )
