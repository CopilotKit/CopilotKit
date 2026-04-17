"""
Tools for the showcase LangGraph agent.

Wraps shared implementations with LangGraph @tool decorators.
"""

from src.agents.tools import get_weather_impl, query_data_impl, schedule_meeting_impl

from langchain_core.tools import tool

@tool
def query_data(query: str):
    """
    Query the database. Takes natural language.
    Call ONCE to get data, then pass the result to a chart frontend tool (pieChart or barChart).
    Do not call repeatedly -- one call returns the full dataset.
    """
    return query_data_impl(query)

@tool
def get_weather(location: str):
    """
    Get the current weather for a location.
    """
    return get_weather_impl(location)

@tool
def schedule_meeting(reason: str, duration_minutes: int = 30):
    """Schedule a meeting. The user will be asked to pick a time via the UI."""
    return schedule_meeting_impl(reason, duration_minutes)
