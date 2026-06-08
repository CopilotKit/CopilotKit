"""LangGraph agent backing the Beautiful Chat demo.

Verbatim port of the canonical starter at /examples/integrations/langgraph-python.
Reference structure (agent/main.py + agent/src/{todos,query,a2ui_fixed_schema,
a2ui_dynamic_schema}.py) is inlined here into a single module to match the
showcase cell's flat backend layout.

Data files (db.csv + schemas/) live alongside this module under
`beautiful_chat_data/` to keep the cell self-contained without polluting the
shared `a2ui_schemas/` directory (which is owned by a2ui_fixed.py).
"""

from __future__ import annotations

import csv
import uuid
from pathlib import Path
from typing import Literal, TypedDict

from copilotkit import (
    CopilotKitMiddleware,
    StateItem,
    StateStreamingMiddleware,
    a2ui,
)
from langchain.agents import AgentState as BaseAgentState
from langchain.agents import create_agent
from langchain.messages import ToolMessage
from langchain.tools import ToolRuntime, tool
from langchain_openai import ChatOpenAI
from langgraph.types import Command


# ─── Shared state schema ────────────────────────────────────────────


class Todo(TypedDict):
    id: str
    title: str
    description: str
    emoji: str
    status: Literal["pending", "completed"]


class AgentState(BaseAgentState):
    todos: list[Todo]


# ─── Todo tools ─────────────────────────────────────────────────────


@tool
def manage_todos(todos: list[Todo], runtime: ToolRuntime) -> Command:
    """
    Manage the current todos.
    """
    # Ensure all todos have IDs that are unique
    for todo in todos:
        if "id" not in todo or not todo["id"]:
            todo["id"] = str(uuid.uuid4())

    # Update the state
    return Command(
        update={
            "todos": todos,
            "messages": [
                ToolMessage(
                    content="Successfully updated todos",
                    name="manage_todos",
                    id=str(uuid.uuid4()),
                    tool_call_id=runtime.tool_call_id,
                )
            ],
        }
    )


@tool
def get_todos(runtime: ToolRuntime):
    """
    Get the current todos.
    """
    return runtime.state.get("todos", [])


todo_tools = [
    manage_todos,
    get_todos,
]


# ─── Data query tool ────────────────────────────────────────────────

# Read data at module load time to avoid file I/O issues in
# LangGraph Cloud's sandboxed tool execution environment.
_DATA_DIR = Path(__file__).parent / "beautiful_chat_data"
_csv_path = _DATA_DIR / "db.csv"
with open(_csv_path) as _f:
    _cached_data = list(csv.DictReader(_f))


@tool
def query_data(query: str):
    """
    Query the database, takes natural language. Always call before showing a chart or graph.
    """
    return _cached_data


# ─── A2UI fixed-schema tool: flight search ──────────────────────────

CATALOG_ID = "copilotkit://app-dashboard-catalog"
SURFACE_ID = "flight-search-results"


class Flight(TypedDict, total=False):
    # All fields marked optional (`total=False`) so the LLM (or aimock fixture)
    # can omit auxiliary fields like `id` / `statusIcon` without tripping
    # langchain's tool-arg validation. Previously these were required and any
    # missing field surfaced as `Error invoking tool 'search_flights' with
    # kwargs ... flights.N.id: Field required` — the agent treated the error
    # string as the tool result and the surface never rendered.
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
    price: str


def _build_flight_components(flights: list[dict]) -> list[dict]:
    """Build a flat A2UI component tree with one literal FlightCard per flight.

    Avoids the structural-children template form (Row.children = { componentId,
    path }), which the GenericBinder only expands correctly for components whose
    schema declares STRUCTURAL children — sibling demos work because their
    schemas use literal-string-array children. Inlining the values per-flight
    sidesteps the template path entirely and renders identically.
    """
    flight_card_ids: list[str] = []
    components: list[dict] = []
    for index, flight in enumerate(flights):
        card_id = f"flight-card-{index}"
        flight_card_ids.append(card_id)
        components.append(
            {
                "id": card_id,
                "component": "FlightCard",
                "airline": flight.get("airline", ""),
                "airlineLogo": flight.get("airlineLogo", ""),
                "flightNumber": flight.get("flightNumber", ""),
                "origin": flight.get("origin", ""),
                "destination": flight.get("destination", ""),
                "date": flight.get("date", ""),
                "departureTime": flight.get("departureTime", ""),
                "arrivalTime": flight.get("arrivalTime", ""),
                "duration": flight.get("duration", ""),
                "status": flight.get("status", ""),
                "price": flight.get("price", ""),
            }
        )
    root: dict = {
        "id": "root",
        "component": "Row",
        "children": flight_card_ids,
        "gap": 16,
    }
    return [root, *components]


@tool
def search_flights(flights: list[Flight]) -> str:
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: airline (e.g. "United Airlines"),
    airlineLogo (use Google favicon API: https://www.google.com/s2/favicons?domain={airline_domain}&sz=128
    e.g. "https://www.google.com/s2/favicons?domain=united.com&sz=128" for United,
    "https://www.google.com/s2/favicons?domain=delta.com&sz=128" for Delta,
    "https://www.google.com/s2/favicons?domain=aa.com&sz=128" for American,
    "https://www.google.com/s2/favicons?domain=alaskaair.com&sz=128" for Alaska),
    flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" — use near-future dates),
    departureTime, arrivalTime,
    duration (e.g. "4h 25m"), status (e.g. "On Time" or "Delayed"),
    and price (e.g. "$289").
    """
    return a2ui.render(
        operations=[
            a2ui.create_surface(SURFACE_ID, catalog_id=CATALOG_ID),
            a2ui.update_components(SURFACE_ID, _build_flight_components(flights)),
        ],
    )


# ─── A2UI dynamic-schema tool: LLM-generated UI ─────────────────────

CUSTOM_CATALOG_ID = "copilotkit://app-dashboard-catalog"

# ─── Graph ──────────────────────────────────────────────────────────

model = ChatOpenAI(model="gpt-5.4", model_kwargs={"parallel_tool_calls": False})

agent = create_agent(
    model=model,
    tools=[query_data, *todo_tools, search_flights],
    middleware=[
        CopilotKitMiddleware(),
        StateStreamingMiddleware(
            StateItem(state_key="todos", tool="manage_todos", tool_argument="todos")
        ),
    ],
    state_schema=AgentState,
    system_prompt="""
        You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

        Tool guidance:
        - Flights: call search_flights to show flight cards with a pre-built schema.
        - Dashboards & rich UI: call generate_a2ui to create dashboard UIs with metrics,
          charts, tables, and cards. It handles rendering automatically.
        - Charts: call query_data first, then render with the chart component.
        - Todos: enable app mode first, then manage todos.
        - A2UI actions: when you see a log_a2ui_event result (e.g. "view_details"),
          respond with a brief confirmation. The UI already updated on the frontend.
    """,
)

graph = agent
