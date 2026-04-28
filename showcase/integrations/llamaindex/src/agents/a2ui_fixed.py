"""
LlamaIndex agent for the A2UI Fixed Schema demo.

Mirrors `langgraph-python/src/agents/a2ui_fixed.py`: the component tree lives
on the frontend as a known catalog; the agent streams *data* into the data
model at runtime via a `display_flight` tool. The tool result is an
`a2ui_operations` container which the A2UI middleware on the Next.js runtime
detects and forwards to the frontend renderer.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"


# @region[backend-schema-json-load]
# Schemas are JSON so they can be authored and reviewed independently of the
# Python code. `_load_schema` is just a thin `json.load` wrapper.
def _load_schema(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


FLIGHT_SCHEMA = _load_schema(_SCHEMAS_DIR / "flight_schema.json")
# @endregion[backend-schema-json-load]


async def display_flight(
    origin: Annotated[str, "Origin airport code (e.g. 'SFO')."],
    destination: Annotated[str, "Destination airport code (e.g. 'JFK')."],
    airline: Annotated[str, "Airline name."],
    price: Annotated[str, "Price string (e.g. '$289')."],
) -> str:
    """Show a flight card for the given trip.

    Emits an `a2ui_operations` container describing a create_surface +
    update_components + update_data_model sequence. The A2UI middleware on
    the Next.js runtime detects this shape in the tool result and forwards
    the ops to the frontend renderer.
    """
    # @region[backend-render-operations]
    # The A2UI middleware detects the `a2ui_operations` container in this
    # tool result and forwards the ops to the frontend renderer. The frontend
    # catalog resolves component names to the local React components.
    ops = [
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
    return json.dumps({"a2ui_operations": ops})
    # @endregion[backend-render-operations]


SYSTEM_PROMPT = (
    "You help users find flights. When asked about a flight, call "
    "display_flight with origin, destination, airline, and price. "
    "Use short airport codes (e.g. 'SFO', 'JFK') and a price string like "
    "'$289'. Keep any chat reply to one short sentence."
)


a2ui_fixed_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4o-mini"),
    frontend_tools=[],
    backend_tools=[display_flight],
    system_prompt=SYSTEM_PROMPT,
    initial_state={},
)
