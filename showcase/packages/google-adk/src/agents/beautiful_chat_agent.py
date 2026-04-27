"""Agent backing the Beautiful Chat demo.

A canonical "polished starter" agent — has the sales-pipeline tools
(query_data, search_flights, schedule_meeting) so the demo can showcase
chart cards, flight cards, and meeting picker UIs alongside the brand
fonts, theme tokens, and suggestion pills on the frontend.
"""

from __future__ import annotations

import os
import sys

from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"
    ),
)
from tools import (  # noqa: E402
    query_data_impl,
    search_flights_impl,
    schedule_meeting_impl,
)


def query_data(tool_context: ToolContext, query: str) -> list:
    """Query financial data — returns rows for pie / bar charts."""
    return query_data_impl(query)


def search_flights(tool_context: ToolContext, flights: list[dict]) -> dict:
    """Search for flights — returns 2-3 candidate cards."""
    return search_flights_impl(flights)


def schedule_meeting(
    tool_context: ToolContext, reason: str, duration_minutes: int = 30
) -> dict:
    """Schedule a meeting (the user picks a time via the UI)."""
    return schedule_meeting_impl(reason, duration_minutes)


_INSTRUCTION = (
    "You are a polished sales assistant. Use query_data for charts, "
    "search_flights for flight options (return 2-3 plausible flights), "
    "and schedule_meeting when the user wants to book time. Provide a "
    "short textual summary after each tool call."
)

beautiful_chat_agent = LlmAgent(
    name="BeautifulChatAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[query_data, search_flights, schedule_meeting],
)
