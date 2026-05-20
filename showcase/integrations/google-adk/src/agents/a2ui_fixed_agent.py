"""Agent backing the A2UI Fixed-Schema demo.

The component tree is authored ahead of time as JSON (see a2ui_schemas/) and
the agent's `display_flight` tool emits an a2ui_operations container whose
ops apply the schema and seed the data model. The runtime detects the
container in the tool result and forwards surfaces to the frontend renderer.
"""

# @region[backend-render-operations]
# @region[backend-schema-json-load]
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ag_ui_adk import AGUIToolset
from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

from agents.shared_chat import get_model, stop_on_terminal_text

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
# @endregion[backend-schema-json-load]


def _build_flight_operations(
    *, origin: str, destination: str, airline: str, price: str
) -> dict[str, Any]:
    """Build the v0.9 a2ui_operations container the runtime detects.

    Each op uses the v0.9 nested shape (`createSurface` / `updateComponents` /
    `updateDataModel` keys with surfaceId inside) that
    `@ag-ui/a2ui-middleware`'s `getOperationSurfaceId` walks. The previous
    flat shape (`type: "create_surface"`, surfaceId at top level) silently
    grouped under the fallback `"default"` surface, so the renderer never
    saw the schema. Mirrors `copilotkit.a2ui.create_surface` /
    `update_components` / `update_data_model` from the langgraph-python
    north-star.
    """
    return {
        "a2ui_operations": [
            {
                "version": "v0.9",
                "createSurface": {
                    "surfaceId": SURFACE_ID,
                    "catalogId": CATALOG_ID,
                },
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

    After this tool returns, the flight card is already rendered to the user
    via the A2UI surface — the JSON returned here is the surface descriptor
    the renderer consumes, NOT a status code. Do NOT call this tool again
    for the same flight (the user already sees the card). Reply with one
    short confirmation sentence and stop.
    """
    return _build_flight_operations(
        origin=origin, destination=destination, airline=airline, price=price
    )


# Mirrors the LangGraph-Python sibling's system prompt (see
# `showcase/integrations/langgraph-python/src/agents/a2ui_fixed.py`).
# Regression #4734: tighter "exactly ONCE" guard + "do NOT call again"
# stop language is the fix for the Railway loop where the LLM kept
# re-calling display_flight because it couldn't tell the opaque
# `a2ui.render(...)` JSON return value was a success signal.
_INSTRUCTION = (
    "You help users find flights. When asked about a flight, call "
    "display_flight exactly ONCE with origin, destination, airline, and "
    "price. The tool's JSON return value is an A2UI surface descriptor — "
    "the flight card is already rendered to the user; do NOT call "
    "display_flight again for the same trip. After the tool returns, reply "
    "with one short confirmation sentence and stop."
)

a2ui_fixed_agent = LlmAgent(
    name="A2uiFixedAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[display_flight, AGUIToolset()],
    after_model_callback=stop_on_terminal_text,
)
