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
import json
import uuid
from pathlib import Path
from typing import Any, Literal, TypedDict

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
from langchain_core.messages import SystemMessage
from langchain_core.tools import tool as lc_tool
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
    return Command(update={
        "todos": todos,
        "messages": [
            ToolMessage(
                content="Successfully updated todos",
                tool_call_id=runtime.tool_call_id
            )
        ]
    })


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
    import time
    print(f"[A2UI-DEBUG] query_data called: query='{query[:60]}' at {time.strftime('%H:%M:%S')}")
    return _cached_data


# ─── A2UI fixed-schema tool: flight search ──────────────────────────

CATALOG_ID = "copilotkit://app-dashboard-catalog"
SURFACE_ID = "flight-search-results"
FLIGHT_SCHEMA = a2ui.load_schema(
    _DATA_DIR / "schemas" / "flight_schema.json"
)


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


@tool
def search_flights(flights: list[Flight]) -> str:
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: id, airline (e.g. "United Airlines"),
    airlineLogo (use Google favicon API: https://www.google.com/s2/favicons?domain={airline_domain}&sz=128
    e.g. "https://www.google.com/s2/favicons?domain=united.com&sz=128" for United,
    "https://www.google.com/s2/favicons?domain=delta.com&sz=128" for Delta,
    "https://www.google.com/s2/favicons?domain=aa.com&sz=128" for American,
    "https://www.google.com/s2/favicons?domain=alaskaair.com&sz=128" for Alaska),
    flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" — use near-future dates),
    departureTime, arrivalTime,
    duration (e.g. "4h 25m"), status (e.g. "On Time" or "Delayed"),
    statusIcon (colored dot: use "https://placehold.co/12/22c55e/22c55e.png"
    for On Time, "https://placehold.co/12/eab308/eab308.png" for Delayed,
    "https://placehold.co/12/ef4444/ef4444.png" for Cancelled),
    and price (e.g. "$289").
    """
    return a2ui.render(
        operations=[
            a2ui.create_surface(SURFACE_ID, catalog_id=CATALOG_ID),
            a2ui.update_components(SURFACE_ID, FLIGHT_SCHEMA),
            a2ui.update_data_model(SURFACE_ID, {"flights": flights}),
        ],
    )


# ─── A2UI dynamic-schema tool: LLM-generated UI ─────────────────────

CUSTOM_CATALOG_ID = "copilotkit://app-dashboard-catalog"


@lc_tool
def render_a2ui(
    surfaceId: str,
    catalogId: str,
    components: list[dict],
    data: dict | None = None,
) -> str:
    """Render a dynamic A2UI v0.9 surface.

    Args:
        surfaceId: Unique surface identifier.
        catalogId: The catalog ID (use "copilotkit://app-dashboard-catalog").
        components: A2UI v0.9 component array (flat format). The root
            component must have id "root".
        data: Optional initial data model for the surface (e.g. form values,
            list items for data-bound components).
    """
    return "rendered"


@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.
    """
    import time
    t0 = time.time()
    print(f"[A2UI-DEBUG] generate_a2ui STARTED at t=0")

    messages = runtime.state["messages"][:-1]
    print(f"[A2UI-DEBUG]   messages count: {len(messages)}")

    # Get context entries from copilotkit state (catalog capabilities + component schema)
    context_entries = runtime.state.get("copilotkit", {}).get("context", [])
    context_text = "\n\n".join(
        entry.get("value", "") for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )
    print(f"[A2UI-DEBUG]   context entries: {len(context_entries)}, context_text_len: {len(context_text)}")

    prompt = context_text

    model = ChatOpenAI(model="gpt-4.1")
    model_with_tool = model.bind_tools(
        [render_a2ui],
        tool_choice="render_a2ui",
    )

    print(f"[A2UI-DEBUG]   calling secondary LLM at t={time.time()-t0:.1f}s")
    response = model_with_tool.invoke(
        [SystemMessage(content=prompt), *messages],
    )
    print(f"[A2UI-RESPONSE] {response}")
    print(f"[A2UI-DEBUG]   secondary LLM responded at t={time.time()-t0:.1f}s")

    if not response.tool_calls:
        print(f"[A2UI-DEBUG]   ERROR: no tool calls in response")
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.tool_calls[0]
    args = tool_call["args"]

    surface_id = args.get("surfaceId", "dynamic-surface")
    catalog_id = args.get("catalogId", CUSTOM_CATALOG_ID)
    components = args.get("components", [])
    data = args.get("data", {})
    print(f"[A2UI-DEBUG]   components={len(components)} data_keys={list(data.keys()) if data else []} surface={surface_id}")

    ops = [
        a2ui.create_surface(surface_id, catalog_id=catalog_id),
        a2ui.update_components(surface_id, components),
    ]
    if data:
        ops.append(a2ui.update_data_model(surface_id, data))

    result = a2ui.render(operations=ops)
    print(f"[A2UI-DEBUG] generate_a2ui DONE at t={time.time()-t0:.1f}s result_len={len(result)}")
    return result


# ─── Graph ──────────────────────────────────────────────────────────

model = ChatOpenAI(model="gpt-5.4", model_kwargs={"parallel_tool_calls": False})

agent = create_agent(
    model=model,
    tools=[query_data, *todo_tools, generate_a2ui, search_flights],
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
