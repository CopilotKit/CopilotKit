"""
CrewAI tools wrapping shared showcase implementations.

Provides weather, query data, and schedule meeting tools for the crew.
"""

# @region[weather-tool-backend]
import json

from crewai.tools import BaseTool
from typing import Type
from pydantic import BaseModel, Field

from tools import (
    get_weather_impl,
    query_data_impl,
    schedule_meeting_impl,
    build_a2ui_operations_from_tool_call,
)
from typing import Any, List


class GetWeatherInput(BaseModel):
    """Input schema for GetWeatherTool."""

    location: str = Field(..., description="The location to get weather for.")


class GetWeatherTool(BaseTool):
    name: str = "get_weather"
    description: str = (
        "Get current weather for a location. Ensure location is fully spelled out."
    )
    args_schema: Type[BaseModel] = GetWeatherInput

    def _run(self, location: str) -> str:
        return json.dumps(get_weather_impl(location))


# @endregion[weather-tool-backend]


class QueryDataInput(BaseModel):
    """Input schema for QueryDataTool."""

    query: str = Field(
        ..., description="The query to run against the financial database."
    )


class QueryDataTool(BaseTool):
    name: str = "query_data"
    description: str = "Query financial database for chart data. Returns data suitable for pie or bar charts."
    args_schema: Type[BaseModel] = QueryDataInput

    def _run(self, query: str) -> str:
        return json.dumps(query_data_impl(query))


class ScheduleMeetingInput(BaseModel):
    """Input schema for ScheduleMeetingTool."""

    reason: str = Field(..., description="Reason for scheduling the meeting.")
    duration_minutes: int = Field(30, description="Duration of the meeting in minutes.")


class ScheduleMeetingTool(BaseTool):
    name: str = "schedule_meeting"
    description: str = (
        "Schedule a meeting with user approval. Returns available time slots."
    )
    args_schema: Type[BaseModel] = ScheduleMeetingInput

    def _run(self, reason: str, duration_minutes: int = 30) -> str:
        return json.dumps(schedule_meeting_impl(reason, duration_minutes))


# LGP beautiful_chat.py card surface — inlined FlightCards, not the
# shared search_flights_impl template + data-model form.
FLIGHT_CATALOG_ID = "copilotkit://app-dashboard-catalog"
FLIGHT_SURFACE_ID = "flight-search-results"


def build_flight_components(flights: list) -> list[dict]:
    """Build a flat A2UI tree with one literal FlightCard per flight.

    Copied from langgraph-python `beautiful_chat._build_flight_components`.
    Avoids the structural-children template form (Row.children =
    {componentId, path}), which the GenericBinder only expands correctly
    for components whose schema declares STRUCTURAL children.
    """
    flight_card_ids: list[str] = []
    components: list[dict] = []
    for index, flight in enumerate(flights or []):
        card_id = f"flight-card-{index}"
        flight_card_ids.append(card_id)
        components.append(
            {
                "id": card_id,
                "component": "FlightCard",
                "airline": flight.get("airline", ""),
                "airlineLogo": flight.get("airlineLogo", ""),
                "flightNumber": flight.get("flightNumber", ""),
                "origin": flight.get("origin", ""),
                "destination": flight.get("destination", ""),
                "date": flight.get("date", ""),
                "departureTime": flight.get("departureTime", ""),
                "arrivalTime": flight.get("arrivalTime", ""),
                "duration": flight.get("duration", ""),
                "status": flight.get("status", ""),
                "price": flight.get("price", ""),
            }
        )
    root: dict = {
        "id": "root",
        "component": "Row",
        "children": flight_card_ids,
        "gap": 16,
    }
    return [root, *components]


def render_search_flights_a2ui(flights: list) -> str:
    """LGP `a2ui.render` shape for beautiful-chat search_flights."""
    ops: list[dict[str, Any]] = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": FLIGHT_SURFACE_ID,
                "catalogId": FLIGHT_CATALOG_ID,
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": FLIGHT_SURFACE_ID,
                "components": build_flight_components(flights),
            },
        },
    ]
    return json.dumps({"a2ui_operations": ops})


class SearchFlightsInput(BaseModel):
    """Input schema for SearchFlightsTool."""

    flights: List[dict] = Field(
        ..., description="List of flight objects to search/display."
    )


class SearchFlightsTool(BaseTool):
    name: str = "search_flights"
    description: str = (
        "Search for flights and display the results as rich cards. Return exactly 2 flights. "
        'Each flight must have: airline (e.g. "United Airlines"), airlineLogo, flightNumber, '
        "origin, destination, date, departureTime, arrivalTime, duration, status, and price "
        '(e.g. "$349" / "$289").'
    )
    args_schema: Type[BaseModel] = SearchFlightsInput

    def _run(self, flights: list) -> str:
        return render_search_flights_a2ui(flights)


class GenerateA2uiInput(BaseModel):
    """Input schema for GenerateA2uiTool."""

    context: str = Field(..., description="Conversation context to generate UI for.")


class GenerateA2uiTool(BaseTool):
    name: str = "generate_a2ui"
    description: str = (
        "Generate dynamic A2UI components based on the conversation. "
        "A secondary LLM designs the UI schema and data."
    )
    args_schema: Type[BaseModel] = GenerateA2uiInput

    def _run(self, context: str) -> str:
        from openai import OpenAI

        client = OpenAI()
        tool_schema = {
            "type": "function",
            "function": {
                "name": "render_a2ui",
                "description": "Render a dynamic A2UI v0.9 surface.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "surfaceId": {"type": "string"},
                        "catalogId": {"type": "string"},
                        "components": {"type": "array", "items": {"type": "object"}},
                        "data": {"type": "object"},
                    },
                    "required": ["surfaceId", "catalogId", "components"],
                },
            },
        }

        response = client.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {
                    "role": "system",
                    "content": context or "Generate a useful dashboard UI.",
                },
                {
                    "role": "user",
                    "content": "Generate a dynamic A2UI dashboard based on the conversation.",
                },
            ],
            tools=[tool_schema],
            tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
        )

        if not response.choices[0].message.tool_calls:
            return json.dumps({"error": "LLM did not call render_a2ui"})

        tool_call = response.choices[0].message.tool_calls[0]
        args = json.loads(tool_call.function.arguments)
        result = build_a2ui_operations_from_tool_call(args)
        return json.dumps(result)
