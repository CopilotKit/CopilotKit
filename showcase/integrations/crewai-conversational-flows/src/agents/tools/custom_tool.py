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
    RENDER_A2UI_TOOL_SCHEMA,
    get_weather_impl,
    query_data_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)
from typing import Any, List, Optional


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


class SearchFlightsInput(BaseModel):
    """Input schema for SearchFlightsTool."""

    flights: Optional[List[dict]] = Field(
        None,
        description=(
            "Optional route hints from an existing fixture. The mock search "
            "returns the showcase's canonical United and Delta results."
        ),
    )
    origin: str = Field("SFO", description="Origin airport code.")
    destination: str = Field("JFK", description="Destination airport code.")


class SearchFlightsTool(BaseTool):
    name: str = "search_flights"
    description: str = (
        "Search mock flights and display exactly two canonical rich cards: "
        "United at $349 and Delta at $289. Supply only origin and destination."
    )
    args_schema: Type[BaseModel] = SearchFlightsInput

    def _run(
        self,
        flights: Optional[list] = None,
        origin: str = "SFO",
        destination: str = "JFK",
    ) -> str:
        if flights:
            origin = str(flights[0].get("origin") or origin)
            destination = str(flights[0].get("destination") or destination)
        canonical_flights = [
            {
                "airline": "United",
                "airlineLogo": "https://www.google.com/s2/favicons?domain=united.com&sz=128",
                "flightNumber": "UA231",
                "origin": origin,
                "destination": destination,
                "date": "Tue, Aug 18",
                "departureTime": "08:00",
                "arrivalTime": "16:30",
                "duration": "5h 30m",
                "status": "On Time",
                "statusColor": "#22c55e",
                "price": "$349",
                "currency": "USD",
            },
            {
                "airline": "Delta",
                "airlineLogo": "https://www.google.com/s2/favicons?domain=delta.com&sz=128",
                "flightNumber": "DL412",
                "origin": origin,
                "destination": destination,
                "date": "Tue, Aug 18",
                "departureTime": "11:20",
                "arrivalTime": "19:55",
                "duration": "5h 35m",
                "status": "On Time",
                "statusColor": "#22c55e",
                "price": "$289",
                "currency": "USD",
            },
        ]
        result = search_flights_impl(canonical_flights)
        return json.dumps(result)


class GenerateA2uiInput(BaseModel):
    """Input schema for GenerateA2uiTool."""

    context: str = Field(..., description="Conversation context to generate UI for.")


def _generate_a2ui_completion_params(context: str) -> dict[str, Any]:
    return {
        "model": "gpt-5.4",
        "messages": [
            {
                "role": "system",
                "content": context or "Generate a useful dashboard UI.",
            },
            {
                "role": "user",
                "content": "Generate a dynamic A2UI dashboard based on the conversation.",
            },
        ],
        "tools": [{"type": "function", "function": RENDER_A2UI_TOOL_SCHEMA}],
        "tool_choice": {"type": "function", "function": {"name": "render_a2ui"}},
    }


def _generate_a2ui_result(response: Any) -> str:
    if not response.choices[0].message.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.choices[0].message.tool_calls[0]
    args = json.loads(tool_call.function.arguments)
    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)


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
        response = client.chat.completions.create(
            **_generate_a2ui_completion_params(context)
        )
        return _generate_a2ui_result(response)

    async def _arun(self, context: str) -> str:
        from openai import AsyncOpenAI

        async with AsyncOpenAI() as client:
            response = await client.chat.completions.create(
                **_generate_a2ui_completion_params(context)
            )
        return _generate_a2ui_result(response)
