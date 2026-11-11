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
from typing import List
from uuid import uuid4

from ag_ui_strands import (
    PredictStateMapping,
    StrandsAgent,
    StrandsAgentConfig,
    ToolBehavior,
    create_strands_app,
)
from dotenv import load_dotenv
from pydantic import BaseModel
from strands import Agent, tool

# Flight data, rendered as generative UI with render_ui
from src.flights import search_flights
from src.model import create_strands_model

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
    # The UI gets the list from the tool arguments (todos_state_from_args
    # below), which also gives every todo without an id a stable one.
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
# Shared-state config: inject todos into the prompt, stream state back on
# every manage_todos tool call.
# ---------------------------------------------------------------------------


def build_todos_prompt(input_data, user_message: str) -> str:
    """Inject the current todos into the prompt.

    The run's AG-UI context (what the page shares with ``useAgentContext`` and
    the runtime's generative UI guide for ``render_ui``) needs no handling
    here: ``ag_ui_strands`` adds it to every model call itself.
    """
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
        todos = [dict(todo) for todo in tool_input.get("todos", [])]
        # The model may omit ids. The UI keys todos by id, and the next run
        # sends this list back as state, so an id given here stays stable.
        for todo in todos:
            if not todo.get("id"):
                todo["id"] = str(uuid4())
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
# COPILOTKIT_AGENT_MODEL (e.g. "anthropic:claude-sonnet-4-5") overrides this and
# every other model site in the agent; unset, this site uses gpt-6-luna.
model = create_strands_model(
    "openai:gpt-6-luna", openai_params={"parallel_tool_calls": False}
)

system_prompt = (
    "You are a polished, professional demo assistant. Keep responses to 1-2 sentences.\n\n"
    "Tool guidance:\n"
    "- Flights: call search_flights, then show the flights with render_ui as a Row\n"
    "  of FlightCard components.\n"
    "- Dashboards & rich UI: call render_ui to build dashboards with metrics, charts,\n"
    "  tables, and cards from the generative UI catalog.\n"
    "- Charts: call query_data first, then render with the chart component.\n"
    "- Todos: enable app mode first, then manage todos.\n"
    "- Diagrams (Excalidraw): when MCP Excalidraw tools are exposed (e.g. create_view),\n"
    "  call create_view ONCE with 3-5 elements (shapes + arrows + optional title text).\n"
    "  Include ONE cameraUpdate at the end to frame the diagram. Do NOT call read_me\n"
    "  even if it appears in the toolset — you already know the basic shape API.\n"
    "- Generative UI actions: a click on a button you rendered (e.g. selecting a\n"
    "  flight) arrives as a user message. Respond with a brief confirmation."
)

strands_agent = Agent(
    model=model,
    system_prompt=system_prompt,
    tools=[manage_todos, get_todos, query_data, search_flights],
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
# Only the app's Next.js runtime calls the agent, server to server, so it
# needs no CORS.
app = create_strands_app(agui_agent, agent_path, cors_enabled=False)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("AGENT_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
