"""Agents backing the BYOC (Bring Your Own Component-renderer) demos.

Both byoc-hashbrown and byoc-json-render share one agent: the agent calls
`query_data` to fetch financial chart data; the frontend (with its
respective renderer — @hashbrownai/react or @json-render/react) paints
the result.
"""

from __future__ import annotations

import os

from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

from .tools import query_data_impl  # noqa: E402

def query_data(tool_context: ToolContext, query: str) -> list:
    """Query financial data — returns rows suitable for pie / bar charts."""
    return query_data_impl(query)

_INSTRUCTION = (
    "You are a sales-dashboard assistant. When the user asks for charts, "
    "metrics, or financial data, call `query_data` with a short query "
    "string. The frontend's BYOC renderer paints the result as a chart. "
    "Provide a one-sentence summary after the tool returns."
)

byoc_agent = LlmAgent(
    name="ByocAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[query_data],
)
