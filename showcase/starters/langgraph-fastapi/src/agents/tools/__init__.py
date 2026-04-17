"""Barrel exports for all shared showcase tool implementations."""

from src.agents.types import (
    SalesStage,
    SalesTodo,
    Flight,
    WeatherResult,
)
from src.agents.get_weather import get_weather_impl
from src.agents.query_data import query_data_impl
from src.agents.sales_todos import (
    INITIAL_TODOS,
    manage_sales_todos_impl,
    get_sales_todos_impl,
)
from src.agents.search_flights import search_flights_impl
from src.agents.generate_a2ui import (
    RENDER_A2UI_TOOL_SCHEMA,
    generate_a2ui_impl,
    build_a2ui_operations_from_tool_call,
)
from src.agents.schedule_meeting import schedule_meeting_impl

__all__ = [
    # Types
    "SalesStage",
    "SalesTodo",
    "Flight",
    "WeatherResult",
    # Weather
    "get_weather_impl",
    # Query data
    "query_data_impl",
    # Sales todos
    "INITIAL_TODOS",
    "manage_sales_todos_impl",
    "get_sales_todos_impl",
    # Flight search (fixed-schema A2UI)
    "search_flights_impl",
    # Dynamic A2UI
    "RENDER_A2UI_TOOL_SCHEMA",
    "generate_a2ui_impl",
    "build_a2ui_operations_from_tool_call",
    # Schedule meeting (HITL)
    "schedule_meeting_impl",
]
