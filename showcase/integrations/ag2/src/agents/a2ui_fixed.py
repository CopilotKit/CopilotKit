"""AG2 agent for the Declarative Generative UI (A2UI Fixed Schema) demo.

Fixed-schema A2UI: the component tree (schema) is authored ahead of time
as JSON and shipped with the backend. The agent only streams *data* into
the data model at runtime via the `display_flight` tool. The frontend
registers a matching catalog (see
`src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts`).

Mirrors the langgraph-python `a2ui_fixed.py` reference. The dedicated
runtime route at `api/copilotkit-a2ui-fixed-schema/route.ts` runs the
A2UI middleware with `injectA2UITool: false` because the backend owns
the rendering tool itself.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

from ag2 import Agent
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


async def display_flight(
    origin: Annotated[str, Field(description="Origin airport code, e.g. 'SFO'")],
    destination: Annotated[str, Field(description="Destination airport code, e.g. 'JFK'")],
    airline: Annotated[str, Field(description="Airline name, e.g. 'United'")],
    price: Annotated[str, Field(description="Price string, e.g. '$289'")],
) -> str:
    """Show a flight card for the given trip.

    Emits an `a2ui_operations` container the runtime A2UI middleware
    detects in tool results and forwards to the frontend renderer. The
    frontend catalog resolves component names against the local React
    components.
    """
    # A2UI v0.9 NESTED operation format (createSurface/updateComponents/
    # updateDataModel keys) — the runtime A2UI middleware's
    # getOperationSurfaceId and the frontend renderer only understand this
    # shape (mirrors copilotkit.a2ui helpers in sdk-python/copilotkit/a2ui.py).
    # The previous flat {"type": "create_surface", ...} form parsed as a
    # container but produced ops the renderer could not apply, so the
    # a2ui-fixed-card never mounted.
    operations = [
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
    return json.dumps({"a2ui_operations": operations})


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
    # Guard-rationale note: the 0.x port capped tool-call loops with
    # max_consecutive_auto_reply=4; ag2 1.0 has no direct per-turn
    # auto-reply cap, so no equivalent parameter is set here.
    tools=[display_flight],
)

stream = AGUIStream(agent)
a2ui_fixed_app = FastAPI()
a2ui_fixed_app.mount("", stream.build_asgi())
