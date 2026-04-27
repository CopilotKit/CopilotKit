"""Dedicated crew for the Beautiful Chat flagship demo.

Mirrors `langgraph-python/src/agents/beautiful_chat.py` with CrewAI
plumbing, with two deviations from the langgraph reference tracked in
PARITY_NOTES.md:

1. **MCP Apps skipped.** `ag-ui-crewai` has no MCP SSE client wiring and
   CrewAI crews use a Pydantic-schema `BaseTool` list rather than an MCP
   multiplexer, so the Excalidraw Diagram suggestion is omitted from the
   frontend suggestion pills. A dedicated implementation would require
   first-class MCP support in CrewAI upstream.

2. **Shared-state todos simplified.** The LangGraph reference wires a
   `manage_todos` tool that returns a LangGraph `Command` patching state.
   CrewAI has no equivalent state-patch primitive, so we expose a
   `manage_todos` tool that returns the new todos list as JSON; the
   frontend's `useCoAgent`-backed headless chat picks up the return value
   and maintains the UI state from there.

The crew binds:
- `GetWeatherTool` / `QueryDataTool` / `ScheduleMeetingTool` /
  `SearchFlightsTool` / `GenerateA2uiTool` from the shared tools module.
- A new `ManageTodosTool` for the shared-state todo surface.

The crew has a single agent whose backstory is tuned for polished
short-form responses (1-2 sentences) so the demo's "the UI does the
talking" feel is preserved.
"""

from __future__ import annotations

import json
from typing import Any, List, Type

from crewai import Agent, Crew, Process, Task
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from agents._chat_flow_helpers import preseed_system_prompt
from agents.tools.custom_tool import (
    GenerateA2uiTool,
    GetWeatherTool,
    QueryDataTool,
    ScheduleMeetingTool,
    SearchFlightsTool,
)


class TodoItem(BaseModel):
    """Shape of a single todo matching the frontend's Todo type."""

    id: str = ""
    title: str = ""
    description: str = ""
    emoji: str = ""
    status: str = "pending"


class ManageTodosInput(BaseModel):
    todos: list[dict] = Field(
        ...,
        description=(
            "Full list of todo objects to replace the current app state. "
            'Each todo must have id, title, description, emoji, and status '
            '(one of "pending" | "completed").'
        ),
    )


class ManageTodosTool(BaseTool):
    """Surface that the shared-state 'todos' app reads from.

    Returns the todos list verbatim as the tool result. The frontend's
    headless-chat wrapper picks up the ToolMessage content and updates
    its local todos state.
    """

    name: str = "manage_todos"
    description: str = (
        "Manage the current todos. Pass the FULL list of todos; the "
        "previous list is replaced. Each todo needs id, title, "
        "description, emoji, and status."
    )
    args_schema: Type[BaseModel] = ManageTodosInput

    def _run(self, todos: list[dict]) -> str:
        # Ensure every todo has a non-empty id so the frontend can key it.
        import uuid

        for todo in todos:
            if not todo.get("id"):
                todo["id"] = str(uuid.uuid4())
        return json.dumps({"todos": todos})


CREW_NAME = "BeautifulChat"


BEAUTIFUL_CHAT_BACKSTORY = (
    "You are a polished, professional demo assistant. Keep chat replies "
    "to 1-2 short sentences; let the UI do the talking. "
    "Tool guidance:\n"
    "- Flights: call search_flights to show flight cards with a "
    "pre-built schema.\n"
    "- Dashboards & rich UI: call generate_a2ui to create dashboard "
    "UIs with metrics, charts, tables, and cards. It handles rendering "
    "automatically.\n"
    "- Charts: call query_data first, then render with the chart "
    "component via generate_a2ui.\n"
    "- Todos: call manage_todos with the new full todos list when the "
    "user asks to add, complete, or remove todos.\n"
    "- Meetings: call schedule_meeting when the user wants to book time.\n"
    "- Weather: call get_weather when asked about the weather."
)


preseed_system_prompt(
    CREW_NAME,
    (
        "Polished Beautiful Chat demo. Keep replies to 1-2 short "
        "sentences; call generate_a2ui for dashboards/charts, "
        "search_flights for flight cards, schedule_meeting for "
        "bookings, manage_todos for shared-state todos."
    ),
)


def _build_crew() -> Crew:
    agent = Agent(
        role="Beautiful Chat Demo Assistant",
        goal=(
            "Answer users crisply and rely on tools to render rich UI: "
            "flight cards, dashboards, charts, meeting-time pickers, and "
            "shared-state todo lists."
        ),
        backstory=BEAUTIFUL_CHAT_BACKSTORY,
        verbose=False,
        tools=[
            GetWeatherTool(),
            QueryDataTool(),
            ScheduleMeetingTool(),
            SearchFlightsTool(),
            GenerateA2uiTool(),
            ManageTodosTool(),
        ],
    )

    task = Task(
        description=(
            "Respond to the user. Call the appropriate tool when a "
            "visual / interactive surface would improve the answer."
        ),
        expected_output="A short one-sentence reply plus any rendered UI.",
        agent=agent,
    )

    return Crew(
        name=CREW_NAME,
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=False,
        chat_llm="gpt-4o",
    )


_cached_crew: Crew | None = None


class BeautifulChat:
    """Adapter matching `add_crewai_crew_fastapi_endpoint` shape."""

    name: str = CREW_NAME

    def crew(self) -> Crew:
        global _cached_crew
        if _cached_crew is None:
            _cached_crew = _build_crew()
        return _cached_crew
