"""
CrewAI tools wrapping shared showcase implementations.

Provides weather, query data, and schedule meeting tools for the crew.
"""

import json
import sys
import os

from crewai.tools import BaseTool
from typing import Type
from pydantic import BaseModel, Field

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "..", "shared", "python"
    ),
)
from tools import get_weather_impl, query_data_impl, schedule_meeting_impl


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


class ScheduleMeetingTool(BaseTool):
    name: str = "schedule_meeting"
    description: str = "Schedule a meeting with user approval. Returns available time slots."
    args_schema: Type[BaseModel] = ScheduleMeetingInput

    def _run(self, reason: str) -> str:
        return json.dumps(schedule_meeting_impl(reason))
