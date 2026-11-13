"""Headless Chat (Complete): mock backend tools behind a hand-composed UI.

Prompt and tool bodies match langgraph-python's ``headless_complete.py``
so the shared fixtures and the frontend renderers apply unchanged. The
``@tool`` decorator is dropped: the adapter takes plain callables and
derives each schema from the annotations, so this file must not use
``from __future__ import annotations``.
"""

from agents._common import build

SYSTEM_PROMPT = (
    "You are a helpful, concise assistant wired into a headless chat "
    "surface that demonstrates CopilotKit's full rendering stack. Pick the "
    "right surface for each user question and fall back to plain text when "
    "none of the tools fit.\n\n"
    "Routing rules:\n"
    "  - If the user asks about weather for a place, call `get_weather` "
    "with the location.\n"
    "  - If the user asks about a stock or ticker (AAPL, TSLA, MSFT, ...), "
    "call `get_stock_price` with the ticker.\n"
    "  - If the user asks for a chart, graph, or visualization of revenue, "
    "sales, or other metrics over time, call `get_revenue_chart`.\n"
    "  - If the user asks you to highlight, flag, or mark a short note or "
    "phrase, call the frontend `highlight_note` tool with the text and a "
    "color (yellow, pink, green, or blue). Do NOT ask the user for the "
    "color — pick a sensible one if they didn't say.\n"
    "  - If the user asks to draw, sketch, or diagram something, use the "
    "Excalidraw MCP tools that are available to you.\n"
    "  - Otherwise, reply in plain text.\n\n"
    "After a tool returns, write one short sentence summarizing the "
    "result. Never fabricate data a tool could provide."
)


def get_weather(location: str) -> dict:
    """Get the current weather for a given location.

    Returns a mock payload with city, temperature in Fahrenheit, humidity,
    wind speed, and conditions. Use this whenever the user asks about
    weather anywhere.
    """
    return {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }


def get_stock_price(ticker: str) -> dict:
    """Get a mock current price for a stock ticker.

    Returns a payload with the ticker symbol (uppercased), price in USD,
    and percentage change for the day. Use this whenever the user asks
    about a stock price.
    """
    return {
        "ticker": ticker.upper(),
        "price_usd": 189.42,
        "change_pct": 1.27,
    }


def get_revenue_chart() -> dict:
    """Get a mock six-month revenue series for a chart visualization.

    Returns a title, subtitle, and an array of {label, value} points. Use
    this whenever the user asks for a chart, graph, or visualization of
    revenue, sales, or other quarterly/monthly metrics.
    """
    return {
        "title": "Quarterly revenue",
        "subtitle": "Last six months · USD thousands",
        "data": [
            {"label": "Jan", "value": 38},
            {"label": "Feb", "value": 47},
            {"label": "Mar", "value": 52},
            {"label": "Apr", "value": 49},
            {"label": "May", "value": 63},
            {"label": "Jun", "value": 71},
        ],
    }


def headless_complete_agent():
    return build(
        system_instructions=SYSTEM_PROMPT,
        tools=[get_weather, get_stock_price, get_revenue_chart],
    )
