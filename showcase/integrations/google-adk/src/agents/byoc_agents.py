"""Agents backing the BYOC (Bring Your Own Component-renderer) demos.

Both byoc-hashbrown and byoc-json-render share one agent: the agent calls
`query_data` to fetch financial chart data; the frontend (with its
respective renderer — @hashbrownai/react or @json-render/react) paints
the result.
"""

from __future__ import annotations

from ag_ui_adk import AGUIToolset
from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

from agents.shared_chat import get_model

# Shared tool implementations (via tools symlink -> ../../shared/python/tools)
from tools import query_data_impl


def query_data(tool_context: ToolContext, query: str) -> list:
    """Query financial data — returns rows suitable for pie / bar charts."""
    return query_data_impl(query)


_INSTRUCTION = (
    "You are a helpful data analyst. When the user asks about data, call the "
    "query_data tool. Summarise the result after each tool call."
)

byoc_agent = LlmAgent(
    name="ByocAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[query_data, AGUIToolset()],
)
