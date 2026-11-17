"""Beautiful Chat: the flagship demo's backend half.

Most of this demo's surfaces are frontend tools registered by the page
(``pieChart``, ``barChart``, ``toggleTheme``, ``scheduleTime``,
``enableAppMode``); the adapter hands them to the model as client tools.
The rest lives here, as in langgraph-python's ``beautiful_chat`` graph:

* ``query_data`` returns the sales dataset the chart pills ask for;
* ``search_flights`` returns the A2UI fixed-schema flight surface, which the
  runtime's A2UI middleware paints from the tool result;
* ``manage_todos`` / ``get_todos`` read and write the ``todos`` slot of shared
  state for the Task Manager pill. The page's canvas renders
  ``agent.state.todos`` and writes user edits back with ``agent.setState``.
"""

import uuid
from typing import Any

from ag_ui_openai_agents import shared_state
from agents import Agent, function_tool

from demo_agents._common import MODEL, chat_settings
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
# Non-strict schemas: the todo and flight objects are open dictionaries.
@function_tool(strict_mode=False)
def manage_todos(todos: list[dict[str, Any]]) -> str:
    """Manage the current todos. Pass the complete list, not only the changes.

    Each todo has: id (leave empty for a new todo), title, description,
    emoji, and status ("pending" or "completed").
    """
    for todo in todos:
        if not todo.get("id"):
            todo["id"] = str(uuid.uuid4())
    shared_state().update(todos=todos)
    return "Successfully updated todos"


@function_tool
def get_todos() -> list[dict[str, Any]]:
    """Get the current todos."""
    return shared_state().value.get("todos", [])


# @endregion[shared-state-tools]


@function_tool(strict_mode=False)
def search_flights(flights: list[dict[str, Any]]) -> dict[str, Any]:
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: airline (e.g. "United Airlines"), airlineLogo
    (a Google favicon URL such as
    "https://www.google.com/s2/favicons?domain=united.com&sz=128"),
    flightNumber, origin, destination, date (short readable form like
    "Tue, Apr 15"), departureTime, arrivalTime, duration (e.g. "5h 30m"),
    status (e.g. "On Time") and price (e.g. "$289").
    """
    return search_flights_impl(flights)


@function_tool
def query_data(query: str) -> list[dict[str, Any]]:
    """Query the database, takes natural language. Always call before showing a chart or graph.

    Returns the full financial dataset as a list of rows.
    """
    return query_data_impl(query)


beautiful_chat_agent = Agent(
    name="beautiful_chat",
    instructions=SYSTEM_PROMPT,
    model=MODEL,
    model_settings=chat_settings(),
    tools=[query_data, search_flights, manage_todos, get_todos],
)
