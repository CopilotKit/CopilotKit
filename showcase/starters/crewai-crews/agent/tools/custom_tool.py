"""
CrewAI tools wrapping shared showcase implementations.

Provides weather, query data, and schedule meeting tools for the crew.
"""

import json
import os

from crewai.tools import BaseTool
from typing import Type
from pydantic import BaseModel, Field

from . import (
    get_weather_impl,
    query_data_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)
from typing import Any, List

class GetWeatherInput(BaseModel):
    """Input schema for GetWeatherTool."""
    location: str = Field(..., description="The location to get weather for.")

class GetWeatherTool(BaseTool):
    name: str = "get_weather"
    description: str = "Get current weather for a location. Ensure location is fully spelled out."
    args_schema: Type[BaseModel] = GetWeatherInput

    def _run(self, location: str) -> str:
        return json.dumps(get_weather_impl(location))

class QueryDataInput(BaseModel):
    """Input schema for QueryDataTool."""
    query: str = Field(..., description="The query to run against the financial database.")

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
    description: str = "Schedule a meeting with user approval. Returns available time slots."
    args_schema: Type[BaseModel] = ScheduleMeetingInput

    def _run(self, reason: str, duration_minutes: int = 30) -> str:
        return json.dumps(schedule_meeting_impl(reason, duration_minutes))

class SearchFlightsInput(BaseModel):
    """Input schema for SearchFlightsTool."""
    flights: List[dict] = Field(..., description="List of flight objects to search/display.")

class SearchFlightsTool(BaseTool):
    name: str = "search_flights"
    description: str = (
        "Search for flights and display the results as rich cards. Return exactly 2 flights. "
        "Each flight must have: airline, airlineLogo, flightNumber, origin, destination, "
        "date, departureTime, arrivalTime, duration, status, statusColor, price, and currency."
    )
    args_schema: Type[BaseModel] = SearchFlightsInput

    def _run(self, flights: list) -> str:
        result = search_flights_impl(flights)
        return json.dumps(result)

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
                {"role": "system", "content": context or "Generate a useful dashboard UI."},
                {"role": "user", "content": "Generate a dynamic A2UI dashboard based on the conversation."},
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
