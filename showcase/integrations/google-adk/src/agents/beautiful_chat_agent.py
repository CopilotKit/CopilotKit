"""Agent backing the Beautiful Chat flagship demo.

Canonical pattern (mirrors langgraph-python and ms-agent-python beautiful-chat):

- `query_data` returns rows from a small CSV; the frontend `pieChart` /
  `barChart` components render the result.
- `search_flights` returns A2UI fixed-schema operations for the FlightCard
  catalog component.
- `generate_a2ui` is the dynamic-A2UI tool — it delegates to the secondary
  Gemini planner already wired in `agents/main.py`.
- `manage_todos` writes to shared session state under key `todos` with
  schema `{id, title, description, emoji, status}`. Streaming is enabled
  in `registry.py` via PredictStateMapping so the canvas TodoList renders
  the list as it grows.

The frontend registers `scheduleTime` (HITL), `pieChart`, `barChart`, and
`toggleTheme` via `useHumanInTheLoop` / `useComponent` / `useFrontendTool`
in `src/app/demos/beautiful-chat/hooks/use-generative-ui-examples.tsx`.
The system prompt below references those tool names verbatim so Gemini
learns to invoke them.
"""

from __future__ import annotations

import uuid
from textwrap import dedent

from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.tools import ToolContext

from agents.shared_chat import get_model

# Reuse the secondary-LLM A2UI planner already wired up in `agents.main`
# (uses google.genai with forced tool_config — keeps the package on Gemini
# end-to-end, no OpenAI dependency).
from agents.main import generate_a2ui

# Shared tool implementations live under `showcase/shared/python/tools/`
# and are exposed via the `tools` symlink at the package root.
from tools import (
    query_data_impl,
    search_flights_impl,
)


def query_data(tool_context: ToolContext, query: str) -> list:
    """Query the sales database. Takes natural language. Always call before
    showing a chart or graph (the frontend pieChart / barChart components
    consume the rows returned here)."""
    del tool_context  # state not needed for read-only query
    return query_data_impl(query)


def search_flights(tool_context: ToolContext, flights: list[dict]) -> dict:
    """Search for flights and display the results as rich A2UI cards.

    Return EXACTLY 2 flights. Each flight must have these fields:

    - airline: e.g. "United Airlines"
    - airlineLogo: Google favicon URL,
      "https://www.google.com/s2/favicons?domain={airline_domain}&sz=128"
      (united.com, delta.com, aa.com, alaskaair.com, ...)
    - flightNumber: e.g. "UA123"
    - origin: 3-letter airport code, e.g. "SFO"
    - destination: 3-letter airport code, e.g. "JFK"
    - date: short readable form, e.g. "Tue, Apr 15" — use a near-future date
    - departureTime: 24h time, e.g. "08:00"
    - arrivalTime: 24h time, e.g. "16:30"
    - duration: e.g. "5h 30m"
    - status: "On Time" or "Delayed" or "Cancelled"
    - statusColor: hex string for the status dot — "#22c55e" for On Time,
      "#eab308" for Delayed, "#ef4444" for Cancelled
    - price: e.g. "$349"
    - currency: e.g. "USD"
    """
    del tool_context  # the catalog/surface is owned by the runtime middleware
    return search_flights_impl(flights)


def manage_todos(tool_context: ToolContext, todos: list[dict]) -> dict:
    """Replace the entire list of todos with the provided values.

    Always include EVERY todo you want to keep (this is a wholesale replace,
    not a diff). Each todo needs:

    - id: stable string id; omit to have one assigned
    - title: short title
    - description: 1-2 sentence description
    - emoji: one of 🎯 🔥 ✅ 💡 🚀
    - status: "pending" or "completed"
    """
    normalized: list[dict] = []
    for todo in todos:
        normalized.append(
            {
                "id": todo.get("id") or str(uuid.uuid4()),
                "title": todo.get("title", ""),
                "description": todo.get("description", ""),
                "emoji": todo.get("emoji", "🎯"),
                "status": todo.get("status", "pending"),
            }
        )
    tool_context.state["todos"] = normalized
    return {"status": "ok", "count": len(normalized)}


def _on_before_agent(callback_context: CallbackContext):
    """Initialize `state["todos"]` so useAgent reads `[]` instead of `undefined`
    on first render of the canvas TodoList."""
    if "todos" not in callback_context.state:
        callback_context.state["todos"] = []
    return None


_INSTRUCTION = dedent(
    """
    You are a polished, professional sales-team demo assistant. Keep
    responses to 1-2 sentences.

    Tool guidance (call the right tool — never paste structured content as
    plain text):

    - Charts: call `query_data` first to fetch the rows, then render with
      the frontend `pieChart` or `barChart` component (they appear in your
      tool list — pass `data`, `title`, and a brief `description`).
    - Flights: call `search_flights` with EXACTLY 2 flight objects matching
      the schema in the tool description. The frontend renders an A2UI
      flight card list automatically.
    - Dashboards & rich UI: call `generate_a2ui` for any dashboard, report,
      or summary (metrics, charts, tables, cards). A secondary planner
      designs the surface; the runtime renders it inline.
    - Meetings: when the user asks to schedule, book, or pick a time, call
      the `scheduleTime` frontend tool — DO NOT ask the user for approval
      yourself, the tool's picker UI handles that.
    - Todos: when the user wants to enable app mode, work with todos, or
      manage tasks, call `enableAppMode` first (frontend tool), then
      `manage_todos` with the FULL list (id, title, description, emoji,
      status). Never send partial updates.
    - Theme: call the `toggleTheme` frontend tool to flip light/dark.
    - MCP / Excalidraw: when the user asks for a diagram, call the
      Excalidraw MCP tool that the runtime exposes.

    After executing a tool, send a brief final message summarizing what
    changed.
    """
).strip()


beautiful_chat_agent = LlmAgent(
    name="BeautifulChatAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[query_data, search_flights, manage_todos, generate_a2ui],
    before_agent_callback=_on_before_agent,
)
