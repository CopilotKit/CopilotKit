"""PydanticAI agent for the Declarative Generative UI (A2UI — Fixed Schema) demo.

Mirrors showcase/integrations/langgraph-python/src/agents/a2ui_fixed.py.

Fixed-schema A2UI: the component tree (schema) is authored ahead of time
as JSON and loaded at module load. The agent only streams *data* into
the data model at runtime. The frontend registers a matching catalog
(see `src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts`) that pins the
schema's component names to real React implementations.

The backend emits an `a2ui_operations` container via its
`display_flight` tool. The runtime endpoint
(`/api/copilotkit-a2ui-fixed-schema`) uses `injectA2UITool: false` so
the middleware does not inject its own render_a2ui tool alongside.
"""

from __future__ import annotations

import json
from pathlib import Path
from textwrap import dedent

from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel


CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"


def _load_schema(path: Path) -> list[dict]:
    """Thin wrapper over `json.load` matching the
    langgraph-python helper signature for cross-package parity."""
    with open(path) as f:
        return json.load(f)


# @region[backend-schema-json-load]
# Schemas are JSON so they can be authored and reviewed independently of
# the Python code. ``_load_schema`` is just a thin ``json.load`` wrapper.
FLIGHT_SCHEMA = _load_schema(_SCHEMAS_DIR / "flight_schema.json")
# Kept for future use once action_handlers land on the PydanticAI A2UI
# bridge; the frontend's ActionButton drives an optimistic transition
# locally today.
BOOKED_SCHEMA = _load_schema(_SCHEMAS_DIR / "booked_schema.json")
# @endregion[backend-schema-json-load]


class EmptyState(BaseModel):
    """The a2ui-fixed-schema demo has no persistent per-thread state."""

    pass


SYSTEM_PROMPT = dedent(
    """
    You help users find flights. When asked about a flight, call
    display_flight with origin, destination, airline, and price.
    Keep any chat reply to one short sentence.
    """
).strip()


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1-mini"),
    deps_type=StateDeps[EmptyState],
    system_prompt=SYSTEM_PROMPT,
)


@agent.tool
def display_flight(
    ctx: RunContext[StateDeps[EmptyState]],
    origin: str,
    destination: str,
    airline: str,
    price: str,
) -> str:
    """Show a flight card for the given trip.

    Use short airport codes (e.g. "SFO", "JFK") for origin/destination and a
    price string like "$289".
    """
    # @region[backend-render-operations]
    # The A2UI middleware detects the `a2ui_operations` container in this
    # tool result and forwards the ops to the frontend renderer. The
    # frontend catalog resolves component names to local React components.
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
    # @endregion[backend-render-operations]
