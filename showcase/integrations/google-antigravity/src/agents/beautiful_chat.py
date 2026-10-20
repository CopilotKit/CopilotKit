"""Beautiful Chat: the flight surface is a backend tool, as in the reference.

Most of this demo's surfaces are frontend tools registered by the page
(``pieChart``, ``barChart``, ``toggleTheme``, ``scheduleTime``), and the
adapter turns those into Antigravity custom tools automatically. The
A2UI fixed-schema flight surface is different: the page registers only
the render-side catalog, and ``search_flights`` lives on the agent —
exactly as in ``langgraph-python``'s ``beautiful_chat`` graph.

It has to exist here too. Antigravity's harness validates every tool
name the model emits against the tools it was configured with and aborts
the run with ``unknown_tool`` when one is missing, so a ``search_flights``
call from a model (or an aimock fixture) with no matching tool kills the
turn before any text reaches the chat.

``query_data`` is on the agent for the same reason: the chart and
dashboard suggestion pills all instruct the model to "use the
`query_data` tool to fetch the data first", and langgraph-python's
``beautiful_chat`` graph owns it as a backend tool as well.

``manage_todos`` / ``get_todos`` back the Task Manager pill, as in the
reference. They read and write the ``todos`` slot of shared state with the
adapter's ``experimental_get_state()`` / ``experimental_set_state()``; the
page's canvas renders ``agent.state.todos`` and writes user edits back with ``agent.setState``,
which reaches ``get_todos`` on the next run.

No ``from __future__ import annotations``: the SDK derives the tool
schema from the live annotations.
"""

import uuid

from ag_ui_antigravity import experimental_get_state, experimental_set_state

from agents._common import build
from tools.query_data import query_data_impl
from tools.search_flights import search_flights_impl

SYSTEM_PROMPT = (
    "You are a helpful, concise assistant embedded in a product demo. "
    "Use the tools the surface offers you: charts and theme changes are "
    "frontend tools, data comes from `query_data`, and flight results go "
    "through `search_flights`. For todos, enable app mode first, then call "
    "`get_todos` and `manage_todos` with the complete updated list. "
    "After a tool returns, summarize the result in one short sentence."
)


# @region[shared-state-tools]
def manage_todos(todos: list[dict]) -> str:
    """Manage the current todos. Pass the complete list, not only the changes.

    Each todo has: id (leave empty for a new todo), title, description,
    emoji, and status ("pending" or "completed").
    """
    for todo in todos:
        if not todo.get("id"):
            todo["id"] = str(uuid.uuid4())
    experimental_set_state({**experimental_get_state(), "todos": todos})
    return "Successfully updated todos"


def get_todos() -> list[dict]:
    """Get the current todos."""
    return experimental_get_state().get("todos", [])


# @endregion[shared-state-tools]


def search_flights(flights: list[dict]) -> dict:
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: airline (e.g. "United Airlines"), airlineLogo
    (a Google favicon URL such as
    "https://www.google.com/s2/favicons?domain=united.com&sz=128"),
    flightNumber, origin, destination, date (short readable form like
    "Tue, Apr 15"), departureTime, arrivalTime, duration (e.g. "5h 30m"),
    status (e.g. "On Time") and price (e.g. "$289").
    """
    return search_flights_impl(flights)


def query_data(query: str) -> list[dict]:
    """Query the database, takes natural language. Always call before showing a chart or graph.

    Returns the full financial dataset as a list of rows.
    """
    return query_data_impl(query)


def beautiful_chat_agent():
    return build(
        system_instructions=SYSTEM_PROMPT,
        tools=[query_data, search_flights, manage_todos, get_todos],
    )
