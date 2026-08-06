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

# @region[backend-render-operations]
# @region[backend-schema-json-load]
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Type

from crewai import Agent, Crew, Process, Task
from crewai.flow.flow import Flow, start
from crewai.tools import BaseTool
from litellm import acompletion
from pydantic import BaseModel, Field

from ag_ui_crewai import (
    CopilotKitState,
    copilotkit_emit_tool_result,
    copilotkit_stream,
)

from agents._chat_flow_helpers import preseed_system_prompt


CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"
CREW_NAME = "A2UIFixedSchema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"

# Load flight schema at module load so the first request does not pay I/O
# for the JSON parse. The schema is authored as JSON so it can be reviewed
# independently of the Python code.
with (_SCHEMAS_DIR / "flight_schema.json").open() as _fp:
    _FLIGHT_SCHEMA = json.load(_fp)
# @endregion[backend-schema-json-load]


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
        # The A2UI middleware detects the `a2ui_operations` container in this
        # tool result and forwards the ops to the frontend renderer. The
        # frontend catalog resolves component names to local React components.
        ops: list[dict[str, Any]] = [
            {
                "version": "v0.9",
                "createSurface": {"surfaceId": SURFACE_ID, "catalogId": CATALOG_ID},
            },
            {
                "version": "v0.9",
                "updateComponents": {
                    "surfaceId": SURFACE_ID,
                    "components": _FLIGHT_SCHEMA,
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
        return json.dumps({"a2ui_operations": ops})
        # @endregion[backend-render-operations]


DISPLAY_FLIGHT_SCHEMA = {
    "type": "function",
    "function": {
        "name": "display_flight",
        "description": DisplayFlightTool.model_fields["description"].default,
        "parameters": DisplayFlightInput.model_json_schema(),
    },
}


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
        chat_llm="gpt-5.4",
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


class A2UIFixedFlow(Flow[CopilotKitState]):
    """Own the backend tool lifecycle so A2UI receives its result event."""

    @start()
    async def chat(self) -> None:
        tools = [*self.state.copilotkit.actions, DISPLAY_FLIGHT_SCHEMA]
        for _iteration in range(3):
            response = await copilotkit_stream(
                await acompletion(
                    model="openai/gpt-5.4",
                    messages=[
                        {"role": "system", "content": A2UI_FIXED_BACKSTORY},
                        *self.state.messages,
                    ],
                    tools=tools,
                    parallel_tool_calls=False,
                    stream=True,
                )
            )
            message = response.choices[0].message
            self.state.messages.append(message)
            calls = message.get("tool_calls") or []
            if not calls:
                return

            for call in calls:
                if call.get("function", {}).get("name") != "display_flight":
                    return
                try:
                    arguments = json.loads(
                        call.get("function", {}).get("arguments") or "{}"
                    )
                except (TypeError, json.JSONDecodeError):
                    arguments = {}
                content = DisplayFlightTool()._run(
                    origin=str(arguments.get("origin", "SFO")),
                    destination=str(arguments.get("destination", "JFK")),
                    airline=str(arguments.get("airline", "United")),
                    price=str(arguments.get("price", "$289")),
                )
                tool_call_id = call.get("id")
                self.state.messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": content,
                    }
                )
                await copilotkit_emit_tool_result(tool_call_id, content)


a2ui_fixed_flow = A2UIFixedFlow()
