"""AG2 agent for the Declarative Generative UI (A2UI Fixed Schema) demo.

Fixed-schema A2UI: the component tree (schema) is authored ahead of time
as JSON and shipped with the backend. The agent only streams *data* into
the data model at runtime via the `display_flight` tool. The frontend
registers a matching catalog (see
`src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts`).

The dedicated runtime route at
`api/copilotkit-a2ui-fixed-schema/route.ts` runs the A2UI middleware with
`injectA2UITool: false` because the backend owns the rendering tool
itself.

Relationship to the langgraph-python reference
----------------------------------------------
The demo behavior matches `langgraph-python/src/agents/a2ui_fixed.py`,
but the operations are assembled here rather than via the `copilotkit`
Python SDK's `a2ui.render()` / `a2ui.create_surface()` helpers: this
integration deliberately depends only on `ag2` (see `requirements.txt`)
so it stays free of the SDK's langchain dependency chain. The builders
below are the dependency-free equivalents of those helpers.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any

from ag2 import Agent
from ag2.a2ui.constants import A2UI_DEFAULT_VERSION
from ag2.config import OpenAIConfig
from ag2.ag_ui import AGUIStream
from fastapi import FastAPI
from pydantic import Field


CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"


def _load_schema(filename: str) -> list[dict]:
    """Load an A2UI fixed schema from the local schemas directory."""
    with open(_SCHEMAS_DIR / filename, "r", encoding="utf-8") as fh:
        return json.load(fh)


FLIGHT_SCHEMA = _load_schema("flight_schema.json")


# --- A2UI operation builders -------------------------------------------------
# A2UI uses the NESTED operation format (createSurface / updateComponents /
# updateDataModel keys). The runtime middleware's getOperationSurfaceId and the
# frontend renderer understand only this shape — the flat
# {"type": "create_surface", ...} form parses as a container but yields ops the
# renderer cannot apply, so the card never mounts.


def _create_surface(surface_id: str, catalog_id: str) -> dict[str, Any]:
    """Declare a render surface bound to a frontend component catalog."""
    return {
        "version": A2UI_DEFAULT_VERSION,
        "createSurface": {"surfaceId": surface_id, "catalogId": catalog_id},
    }


def _update_components(surface_id: str, components: list[dict]) -> dict[str, Any]:
    """Install the component tree (the fixed schema) on the surface."""
    return {
        "version": A2UI_DEFAULT_VERSION,
        "updateComponents": {"surfaceId": surface_id, "components": components},
    }


def _update_data_model(
    surface_id: str, value: dict[str, Any], path: str = "/"
) -> dict[str, Any]:
    """Write runtime data into the surface's data model at `path`."""
    return {
        "version": A2UI_DEFAULT_VERSION,
        "updateDataModel": {"surfaceId": surface_id, "path": path, "value": value},
    }


@dataclass(slots=True)
class A2UIOperations:
    """Container the A2UI middleware detects in a tool result.

    Returned as a dataclass rather than a hand-serialized JSON string:
    ag2 1.0 accepts any `SendableMessage` (dataclass, dict, list, ...) as
    a tool return value and encodes it for the wire itself, so the tool
    stays declarative and the `a2ui_operations` key is typed instead of
    being a magic string inside a `json.dumps` call.
    """

    a2ui_operations: list[dict[str, Any]]


async def display_flight(
    origin: Annotated[str, Field(description="Origin airport code, e.g. 'SFO'")],
    destination: Annotated[str, Field(description="Destination airport code, e.g. 'JFK'")],
    airline: Annotated[str, Field(description="Airline name, e.g. 'United'")],
    price: Annotated[str, Field(description="Price string, e.g. '$289'")],
) -> A2UIOperations:
    """Show a flight card for the given trip.

    After this tool returns, the card is already rendered to the user via
    the A2UI surface — the operations returned here are the surface
    descriptor the renderer consumes, NOT a status code. Do NOT call the
    tool again for the same flight; reply with one short confirmation
    sentence and stop.
    """
    return A2UIOperations(
        [
            _create_surface(SURFACE_ID, CATALOG_ID),
            _update_components(SURFACE_ID, FLIGHT_SCHEMA),
            _update_data_model(
                SURFACE_ID,
                {
                    "origin": origin,
                    "destination": destination,
                    "airline": airline,
                    "price": price,
                },
            ),
        ]
    )


SYSTEM_PROMPT = (
    "You help users find flights. When asked about a flight, call "
    "display_flight with origin (3-letter code), destination (3-letter "
    "code), airline, and price (e.g. '$289'). Keep any chat reply to one "
    "short sentence."
)


agent = Agent(
    name="a2ui_fixed_assistant",
    prompt=SYSTEM_PROMPT,
    config=OpenAIConfig(model="gpt-4o-mini", streaming=True),
    tools=[display_flight],
)

stream = AGUIStream(agent)
a2ui_fixed_app = FastAPI()
a2ui_fixed_app.mount("", stream.build_asgi())
