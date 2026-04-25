"""Dedicated crew for the A2UI Fixed-Schema demo.

Mirrors `langgraph-python/src/agents/a2ui_fixed.py`:

- The component tree (schema) is authored ahead of time as JSON in
  `agents/a2ui_schemas/flight_schema.json` and loaded at startup.
- The crew binds a `DisplayFlightTool` that, when called, returns an
  `a2ui_operations` container referencing the pre-authored schema and
  filling the data model with the trip-specific values the LLM supplies.
- The runtime's A2UI middleware detects the `a2ui_operations` container in
  the tool result and forwards surfaces to the frontend renderer.

Reference: langgraph-python/src/agents/a2ui_fixed.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Type

from crewai import Agent, Crew, Process, Task
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from ._chat_flow_helpers import preseed_system_prompt

CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"
CREW_NAME = "A2UIFixedSchema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"

# Load flight schema at module load so the first request does not pay I/O
# for the JSON parse.
with (_SCHEMAS_DIR / "flight_schema.json").open() as _fp:
    _FLIGHT_SCHEMA = json.load(_fp)

class DisplayFlightInput(BaseModel):
    """Input schema for DisplayFlightTool."""

    origin: str = Field(..., description='3-letter airport code, e.g. "SFO".')
    destination: str = Field(..., description='3-letter airport code, e.g. "JFK".')
    airline: str = Field(..., description='Airline name, e.g. "United Airlines".')
    price: str = Field(..., description='Price string, e.g. "$289".')

class DisplayFlightTool(BaseTool):
    """Render the pre-authored flight card with the supplied trip data.

    Returns an `a2ui_operations` container that the runtime's A2UI
    middleware serialises into a `render_a2ui` tool result on the AG-UI
    wire. The frontend catalog resolves the component names in the schema
    to real React components.
    """

    name: str = "display_flight"
    description: str = (
        "Show a flight card for the given trip. Use short airport codes "
        '(e.g. "SFO", "JFK") for origin/destination and a price string '
        'like "$289".'
    )
    args_schema: Type[BaseModel] = DisplayFlightInput

    def _run(self, origin: str, destination: str, airline: str, price: str) -> str:
        ops: list[dict[str, Any]] = [
            {
                "type": "create_surface",
                "surfaceId": SURFACE_ID,
                "catalogId": CATALOG_ID,
            },
            {
                "type": "update_components",
                "surfaceId": SURFACE_ID,
                "components": _FLIGHT_SCHEMA,
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

A2UI_FIXED_BACKSTORY = (
    "You help users find flights. When asked about a flight, call the "
    "display_flight tool with origin, destination, airline, and price. "
    "Keep any chat reply to one short sentence."
)

preseed_system_prompt(
    CREW_NAME,
    (
        "A2UI Fixed-Schema demo. When the user asks about a flight, call "
        "display_flight with origin, destination, airline, and price. Keep "
        "chat replies to one short sentence."
    ),
)

def _build_crew() -> Crew:
    agent = Agent(
        role="A2UI Fixed-Schema Flight Finder",
        goal=(
            "Answer the user's flight questions by calling display_flight "
            "to render the pre-authored flight card with their trip data."
        ),
        backstory=A2UI_FIXED_BACKSTORY,
        verbose=False,
        tools=[DisplayFlightTool()],
    )

    task = Task(
        description=(
            "Answer the user. When they ask about a flight, call "
            "display_flight with origin, destination, airline, and price."
        ),
        expected_output="A one-sentence reply plus a rendered flight card.",
        agent=agent,
    )

    return Crew(
        name=CREW_NAME,
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=False,
        chat_llm="gpt-4o-mini",
    )

_cached_crew: Crew | None = None

class A2UIFixedSchema:
    """Adapter matching the shape `add_crewai_crew_fastapi_endpoint` expects."""

    name: str = CREW_NAME

    def crew(self) -> Crew:
        global _cached_crew
        if _cached_crew is None:
            _cached_crew = _build_crew()
        return _cached_crew
