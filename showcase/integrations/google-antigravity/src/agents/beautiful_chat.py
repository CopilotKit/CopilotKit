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

No ``from __future__ import annotations``: the SDK derives the tool
schema from the live annotations.
"""

from agents._common import build
from tools.query_data import query_data_impl
from tools.search_flights import search_flights_impl

SYSTEM_PROMPT = (
    "You are a helpful, concise assistant embedded in a product demo. "
    "Use the tools the surface offers you: charts and theme changes are "
    "frontend tools, data comes from `query_data`, and flight results go "
    "through `search_flights`. "
    "After a tool returns, summarize the result in one short sentence."
)


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
        system_instructions=SYSTEM_PROMPT, tools=[query_data, search_flights]
    )
