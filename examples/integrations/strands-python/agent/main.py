"""Strands AG-UI Integration Example - Proverbs Agent.

This example demonstrates a Strands agent integrated with AG-UI, featuring:
- Shared state management between agent and UI
- Backend tool execution (get_weather, update_proverbs)
- Frontend tools (set_theme_color)
- Generative UI rendering
"""

import csv
import json
import os
from pathlib import Path
from typing import Any, Dict, List
from uuid import uuid4

from ag_ui_strands import (
    PredictStateMapping,
    StrandsAgent,
    StrandsAgentConfig,
    ToolBehavior,
    create_strands_app,
)
from copilotkit import a2ui
from dotenv import load_dotenv
from langchain_core.messages import SystemMessage
from langchain_core.tools import tool as lc_tool
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
from strands import Agent, tool
from strands.models.openai import OpenAIModel

# ---------------------------------------------------------------------------
# Env loading (shared demo root pattern used by the other integration demos)
# ---------------------------------------------------------------------------
_demo_root = Path(__file__).parent.parent
for env_path in (_demo_root / ".env", Path(".env")):
    if env_path.is_file():
        load_dotenv(env_path)
        break
else:
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv()

# ---------------------------------------------------------------------------
# Shared state schema: todos
# ---------------------------------------------------------------------------
# Strands "state" is a free-form dict carried on the AG-UI input. We keep
# the same todos shape as the reference demo so the frontend renders the
# same canvas.


class Todo(BaseModel):
    id: str = ""
    title: str
    description: str
    emoji: str
    status: str = "pending"  # "pending" | "completed"


# ---------------------------------------------------------------------------
# Tools — same names and contracts as langgraph-python
# ---------------------------------------------------------------------------


@tool
def manage_todos(todos: List[Todo]) -> str:
    """Manage the current todos.

    IMPORTANT: Always pass the full todo list, not just new items. Each todo
    should have a title, description, emoji, and status (pending/completed).
    """
    # Strands @tool validates with pydantic but passes ``model_dump()`` output
    # to the function body — so list elements arrive as plain dicts, not
    # ``Todo`` instances. Rehydrate before touching attributes.
    todos = [Todo.model_validate(t) for t in todos]
    # Ensure every todo has a stable id. The state emission callback
    # (state_from_args below) re-reads the tool arguments and sends the
    # final list to the UI, so id injection here is enough.
    for todo in todos:
        if not todo.id:
            todo.id = str(uuid4())
    return "Successfully updated todos"


@tool
def get_todos() -> str:
    """Get the current todos.

    Returns a JSON string of the current todos list. The list is injected
    into the prompt via the state context builder, but this tool is still
    useful when the model wants to re-confirm state.
    """
    # Strands tools don't get a runtime handle, so we rely on the state
    # context builder to surface the list. Returning a marker string tells
    # the model to read state from the prompt it already has.
    return "See the current todos list already provided in the conversation context."


_CSV_PATH = Path(__file__).parent / "src" / "db.csv"
with open(_CSV_PATH) as _f:
    _CACHED_DATA = list(csv.DictReader(_f))


@tool
def query_data(query: str) -> str:
    """Query the database with a natural-language query.

    Always call this before rendering a chart so the UI has data to plot.
    """
    return json.dumps(_CACHED_DATA)


# ---------------------------------------------------------------------------
# A2UI tools (framework-agnostic — use copilotkit.a2ui helpers directly)
# ---------------------------------------------------------------------------
CATALOG_ID = "copilotkit://app-dashboard-catalog"
FLIGHT_SURFACE_ID = "flight-search-results"
FLIGHT_SCHEMA = a2ui.load_schema(
    Path(__file__).parent / "src" / "a2ui" / "schemas" / "flight_schema.json"
)


class Flight(BaseModel):
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


class FlightList(BaseModel):
    flights: List[Flight]


@tool
def search_flights(flight_list: FlightList) -> str:
    """Search for flights and display the results as rich cards.

    Return exactly 2 flights. Each flight must have: id, airline, airlineLogo
    (Google favicon API URL for the airline domain), flightNumber, origin,
    destination, date (e.g. "Tue, Mar 18" — use near-future dates),
    departureTime, arrivalTime, duration (e.g. "4h 25m"), status (e.g.
    "On Time" or "Delayed"), statusIcon (colored dot URL:
    https://placehold.co/12/22c55e/22c55e.png for On Time,
    https://placehold.co/12/eab308/eab308.png for Delayed,
    https://placehold.co/12/ef4444/ef4444.png for Cancelled), and price
    (e.g. "$289").
    """
    # Strands @tool passes plain dicts (model_dump output) — ``flight_list``
    # is a dict, ``flight_list["flights"]`` is a list of dicts. Validate
    # back to Pydantic to enforce the schema, then dump for a2ui rendering.
    parsed = FlightList.model_validate(flight_list)
    flights_payload = [f.model_dump() for f in parsed.flights]
    return a2ui.render(
        operations=[
            a2ui.create_surface(FLIGHT_SURFACE_ID, catalog_id=CATALOG_ID),
            a2ui.update_components(FLIGHT_SURFACE_ID, FLIGHT_SCHEMA),
            a2ui.update_data_model(FLIGHT_SURFACE_ID, {"flights": flights_payload}),
        ],
    )


@lc_tool
def render_a2ui(
    surfaceId: str,
    catalogId: str,
    components: List[Dict[str, Any]],
    data: Dict[str, Any] | None = None,
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


@tool
def generate_a2ui(user_intent: str, agent) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is returned
    as an a2ui_operations container for the middleware to detect and render.

    Seed the secondary LLM with the catalog + component schema entries
    that CopilotKit's runtime middleware injects into
    ``RunAgentInput.context``. The ag_ui_strands adapter forwards those
    entries onto ``agent.state`` under the ``agui_context`` key.
    """
    context_entries = []
    try:
        context_entries = agent.state.get("agui_context") or []
    except Exception:
        context_entries = []

    context_text = "\n\n".join(
        e.get("value", "")
        for e in context_entries
        if isinstance(e, dict) and e.get("value")
    )
    prompt = f"{context_text}\n\n{user_intent}" if context_text else user_intent

    model = ChatOpenAI(model="gpt-4.1")
    model_with_tool = model.bind_tools(
        [render_a2ui],
        tool_choice="render_a2ui",
    )
    try:
        response = model_with_tool.invoke(
            [SystemMessage(content=prompt)],
        )
    except Exception as exc:  # pragma: no cover — surface LLM/network failures
        return json.dumps({"error": f"dynamic-a2ui LLM call failed: {exc}"})

    if not response.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.tool_calls[0]
    args = tool_call["args"]

    surface_id = args.get("surfaceId", "dynamic-surface")
    catalog_id = args.get("catalogId", CATALOG_ID)
    components = args.get("components", []) or []
    data = args.get("data") or {}

    ops = [
        a2ui.create_surface(surface_id, catalog_id=catalog_id),
        a2ui.update_components(surface_id, components),
    ]
    if data:
        ops.append(a2ui.update_data_model(surface_id, data))

    return a2ui.render(operations=ops)


# ---------------------------------------------------------------------------
# Shared-state config: inject todos into the prompt, stream state back on
# every manage_todos tool call.
# ---------------------------------------------------------------------------


def build_todos_prompt(input_data, user_message: str) -> str:
    """Inject the current todos state into the prompt."""
    state_dict = getattr(input_data, "state", None)
    if isinstance(state_dict, dict) and "todos" in state_dict:
        todos_json = json.dumps(state_dict.get("todos", []), indent=2)
        return f"Current todos list:\n{todos_json}\n\nUser request: {user_message}"
    return user_message


async def todos_state_from_args(context):
    """Snapshot state for the UI after a manage_todos call.

    Strands calls this with the tool's parsed arguments. We return the
    `todos` list so the AG-UI layer can emit a STATE_SNAPSHOT event.
    """
    try:
        tool_input = context.tool_input
        if isinstance(tool_input, str):
            tool_input = json.loads(tool_input)
        todos = tool_input.get("todos", [])
        return {"todos": todos}
    except Exception:
        return None


shared_state_config = StrandsAgentConfig(
    state_context_builder=build_todos_prompt,
    tool_behaviors={
        "manage_todos": ToolBehavior(
            state_from_args=todos_state_from_args,
            predict_state=[
                PredictStateMapping(
                    state_key="todos",
                    tool="manage_todos",
                    tool_argument="todos",
                )
            ],
        )
    },
)


# ---------------------------------------------------------------------------
# Agent wiring
# ---------------------------------------------------------------------------
api_key = os.getenv("OPENAI_API_KEY", "")
model = OpenAIModel(
    client_args={"api_key": api_key},
    model_id="gpt-5.4",
    params={"parallel_tool_calls": False},
)

system_prompt = (
    "You are a polished, professional demo assistant. Keep responses to 1-2 sentences.\n\n"
    "Tool guidance:\n"
    "- Flights: call search_flights to show flight cards with a pre-built schema.\n"
    "- Dashboards & rich UI: call generate_a2ui to create dashboard UIs with metrics,\n"
    "  charts, tables, and cards. It handles rendering automatically.\n"
    "- Charts: call query_data first, then render with the chart component.\n"
    "- Todos: enable app mode first, then manage todos.\n"
    "- Diagrams (Excalidraw): when MCP Excalidraw tools are exposed (e.g. create_view),\n"
    "  call create_view ONCE with 3-5 elements (shapes + arrows + optional title text).\n"
    "  Include ONE cameraUpdate at the end to frame the diagram. Do NOT call read_me\n"
    "  even if it appears in the toolset — you already know the basic shape API.\n"
    '- A2UI actions: when you see a log_a2ui_event result (e.g. "view_details"),\n'
    "  respond with a brief confirmation. The UI already updated on the frontend."
)

strands_agent = Agent(
    model=model,
    system_prompt=system_prompt,
    tools=[manage_todos, get_todos, query_data, generate_a2ui, search_flights],
)

agui_agent = StrandsAgent(
    agent=strands_agent,
    name="todo_demo_agent",
    description=(
        "A polished demo assistant matching the canonical langgraph-python "
        "todo / charts / a2ui / flights showcase, running on Strands."
    ),
    config=shared_state_config,
)

agent_path = os.getenv("AGENT_PATH", "/")
app = create_strands_app(agui_agent, agent_path)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("AGENT_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
