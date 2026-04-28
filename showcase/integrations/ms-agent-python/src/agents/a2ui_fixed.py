"""
MS Agent Framework agent for the Declarative Generative UI (A2UI — Fixed Schema) demo.

Fixed-schema A2UI: the component tree (schema) is authored ahead of time as
JSON and loaded at startup. The agent only streams *data* into the data model
at runtime. The frontend registers a matching catalog (see
`src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts`) that pins the schema's
component names to real React implementations.

Reference:
    showcase/integrations/langgraph-python/src/agents/a2ui_fixed.py
"""

from __future__ import annotations

import json
from pathlib import Path
from textwrap import dedent
from typing import Annotated

from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field

CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"


def _load_schema(path: Path) -> list[dict]:
    """Thin JSON loader — mirrors `a2ui.load_schema` from the Python SDK."""
    with open(path) as f:
        return json.load(f)


FLIGHT_SCHEMA = _load_schema(_SCHEMAS_DIR / "flight_schema.json")
BOOKED_SCHEMA = _load_schema(_SCHEMAS_DIR / "booked_schema.json")  # noqa: F841 — kept for parity with LangGraph reference


def _build_a2ui_ops(
    *, origin: str, destination: str, airline: str, price: str
) -> dict:
    """Return the `a2ui_operations` payload for the flight card.

    Mirrors `a2ui.render(operations=[create_surface, update_components,
    update_data_model])` from the Python SDK. The A2UI middleware detects this
    container in the tool result and forwards the ops to the frontend renderer.
    """
    ops = [
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
    return {"a2ui_operations": ops}


@tool(
    name="display_flight",
    description=(
        "Show a flight card for the given trip. Use short airport codes "
        "(e.g. 'SFO', 'JFK') for origin/destination and a price string like '$289'."
    ),
)
def display_flight(
    origin: Annotated[str, Field(description="3-letter origin airport code (e.g. 'SFO').")],
    destination: Annotated[str, Field(description="3-letter destination airport code (e.g. 'JFK').")],
    airline: Annotated[str, Field(description="Airline name (e.g. 'United').")],
    price: Annotated[str, Field(description="Price string including currency, e.g. '$289'.")],
) -> str:
    """Emit an `a2ui_operations` container describing the flight card."""
    return json.dumps(
        _build_a2ui_ops(
            origin=origin,
            destination=destination,
            airline=airline,
            price=price,
        )
    )


SYSTEM_PROMPT = dedent(
    """
    You help users find flights. When asked about a flight, call
    `display_flight` with origin, destination, airline, and price.
    Keep any chat reply to one short sentence.
    """
).strip()


def create_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the MS-Agent-backed a2ui-fixed-schema agent."""
    base_agent = Agent(
        client=chat_client,
        name="a2ui_fixed_agent",
        instructions=SYSTEM_PROMPT,
        tools=[display_flight],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Fixed-schema A2UI flight search demo.",
        require_confirmation=False,
    )
