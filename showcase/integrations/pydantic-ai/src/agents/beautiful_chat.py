"""PydanticAI agent for the Beautiful Chat flagship demo.

Ports the behaviour of showcase/packages/langgraph-python/src/agents/beautiful_chat.py
to PydanticAI while staying within what `agent.to_ag_ui()` currently
supports. The frontend cell exercises:

- shared todo state (managed via a `manage_todos` tool that emits a
  StateSnapshotEvent — PydanticAI does not emit per-token state-streaming
  deltas today, so `StateStreamingMiddleware` is not ported),
- A2UI fixed-schema flight cards (same helper shape as `a2ui_fixed.py`),
- A2UI dynamic-schema dashboards (secondary-LLM pattern mirrored from
  `a2ui_dynamic.py`; this cell uses its own `app-dashboard-catalog`),
- a data-query tool reading the ported `beautiful_chat_data/db.csv`.

The frontend also registers Open Generative UI, human-in-the-loop, and
frontend tools (toggle theme, enable app mode) via hooks — those flow
through the AG-UI protocol's frontend-tool slot, so the backend does not
need to define them.
"""

from __future__ import annotations

import csv
import json
import os
import sys
import uuid
from pathlib import Path
from textwrap import dedent
from typing import Any, Literal, TypedDict

from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel
from ag_ui.core import EventType, StateSnapshotEvent

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"),
)
from tools import build_a2ui_operations_from_tool_call  # noqa: E402


# ── Shared state schema ──────────────────────────────────────────────

class Todo(TypedDict):
    id: str
    title: str
    description: str
    emoji: str
    status: Literal["pending", "completed"]


class BeautifulChatState(BaseModel):
    todos: list[dict[str, Any]] = Field(default_factory=list)


# ── Data (read at module load) ──────────────────────────────────────

_DATA_DIR = Path(__file__).parent / "beautiful_chat_data"
_CSV_PATH = _DATA_DIR / "db.csv"
with open(_CSV_PATH) as _f:
    _CACHED_DATA = list(csv.DictReader(_f))

# ── A2UI fixed-schema: flight card ──────────────────────────────────

FLIGHT_CATALOG_ID = "copilotkit://app-dashboard-catalog"
FLIGHT_SURFACE_ID = "flight-search-results"

with open(_DATA_DIR / "schemas" / "flight_schema.json") as _f:
    FLIGHT_SCHEMA = json.load(_f)


# ── Dynamic A2UI catalog id ─────────────────────────────────────────

DASHBOARD_CATALOG_ID = "copilotkit://app-dashboard-catalog"


# ── System prompt ───────────────────────────────────────────────────

SYSTEM_PROMPT = dedent(
    """
    You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

    Tool guidance:
    - Flights: call search_flights to show flight cards with a pre-built schema.
    - Dashboards & rich UI: call generate_a2ui to create dashboard UIs with metrics,
      charts, tables, and cards. It handles rendering automatically.
    - Charts: call query_data first, then render with the chart component
      (pieChart / barChart are frontend-registered components).
    - Todos: enable app mode first (toggle via the frontend toggleTheme /
      enableAppMode tools), then use manage_todos to update the shared
      todos state.
    - A2UI actions: when you receive an action result event, respond with
      a brief confirmation — the UI already updated on the frontend.
    """
).strip()


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1"),
    deps_type=StateDeps[BeautifulChatState],
    system_prompt=SYSTEM_PROMPT,
)


# ── Todo tools ──────────────────────────────────────────────────────

@agent.tool
async def manage_todos(
    ctx: RunContext[StateDeps[BeautifulChatState]],
    todos: list[dict[str, Any]],
) -> StateSnapshotEvent:
    """Manage the current todos. Pass the complete list of todos back."""
    # Ensure all todos have IDs.
    for todo in todos:
        if not todo.get("id"):
            todo["id"] = str(uuid.uuid4())
    ctx.deps.state.todos = todos
    return StateSnapshotEvent(
        type=EventType.STATE_SNAPSHOT,
        snapshot=ctx.deps.state,
    )


@agent.tool
def get_todos(ctx: RunContext[StateDeps[BeautifulChatState]]) -> str:
    """Get the current todos."""
    return json.dumps(ctx.deps.state.todos or [])


# ── Query tool ──────────────────────────────────────────────────────

@agent.tool
def query_data(
    ctx: RunContext[StateDeps[BeautifulChatState]], query: str
) -> str:
    """Query the database, takes natural language.

    Always call before showing a chart or graph. Returns the raw rows
    from the mock sales CSV — callers are expected to bucket / aggregate
    for their visualisation.
    """
    return json.dumps(_CACHED_DATA)


# ── Fixed-schema flights tool ───────────────────────────────────────

class Flight(TypedDict):
    id: str
    airline: str
    airlineLogo: str
    flightNumber: str
    origin: str
    destination: str
    date: str
    departureTime: str
    arrivalTime: str
    duration: str
    status: str
    statusIcon: str
    price: str


@agent.tool
def search_flights(
    ctx: RunContext[StateDeps[BeautifulChatState]],
    flights: list[dict[str, Any]],
) -> str:
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: id, airline (e.g. "United Airlines"),
    airlineLogo (use Google favicon API: https://www.google.com/s2/favicons?domain={airline_domain}&sz=128
    — e.g. "https://www.google.com/s2/favicons?domain=united.com&sz=128" for
    United; delta.com for Delta; aa.com for American; alaskaair.com for Alaska),
    flightNumber, origin, destination, date (short readable format like
    "Tue, Mar 18" — use near-future dates), departureTime, arrivalTime,
    duration (e.g. "4h 25m"), status (e.g. "On Time"), statusIcon (coloured
    dot like "https://placehold.co/12/22c55e/22c55e.png"), and price (e.g. "$289").
    """
    operations = [
        {
            "type": "create_surface",
            "surfaceId": FLIGHT_SURFACE_ID,
            "catalogId": FLIGHT_CATALOG_ID,
        },
        {
            "type": "update_components",
            "surfaceId": FLIGHT_SURFACE_ID,
            "components": FLIGHT_SCHEMA,
        },
        {
            "type": "update_data_model",
            "surfaceId": FLIGHT_SURFACE_ID,
            "data": {"flights": flights},
        },
    ]
    return json.dumps({"a2ui_operations": operations})


# ── Dynamic-schema dashboard tool ───────────────────────────────────

@agent.tool
def generate_a2ui(ctx: RunContext[StateDeps[BeautifulChatState]]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema + data. Returned as an
    `a2ui_operations` container for the middleware to detect.
    """
    from openai import OpenAI

    copilotkit_state = getattr(ctx.deps, "copilotkit", None)
    conversation_messages: list[dict] = []
    context_entries: list[dict] = []
    if copilotkit_state:
        if hasattr(copilotkit_state, "messages"):
            for msg in (copilotkit_state.messages or []):
                role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
                if role in ("user", "assistant"):
                    content = ""
                    if hasattr(msg, "content"):
                        if isinstance(msg.content, str):
                            content = msg.content
                        elif isinstance(msg.content, list):
                            parts = []
                            for part in msg.content:
                                if hasattr(part, "text"):
                                    parts.append(part.text)
                                elif isinstance(part, dict) and "text" in part:
                                    parts.append(part["text"])
                            content = "".join(parts)
                    if content:
                        conversation_messages.append({"role": role, "content": content})
        if hasattr(copilotkit_state, "context"):
            context_entries = copilotkit_state.context or []

    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )

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

    llm_messages: list[dict] = [
        {
            "role": "system",
            "content": context_text
            or "Generate a useful dashboard UI from the conversation so far.",
        },
    ]
    llm_messages.extend(conversation_messages)

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=llm_messages,
        tools=[tool_schema],
        tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
    )

    if not response.choices[0].message.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.choices[0].message.tool_calls[0]
    args = json.loads(tool_call.function.arguments)
    args.setdefault("catalogId", DASHBOARD_CATALOG_ID)
    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)
