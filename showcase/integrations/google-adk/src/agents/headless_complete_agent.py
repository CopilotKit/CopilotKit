"""ADK agent backing the Headless Chat (Complete) demo.

Ports the langgraph-python sibling (`src/agents/headless_complete.py`) to
ADK: three mock backend tools (`get_weather`, `get_stock_price`,
`get_revenue_chart`) that the per-tool renderers on the frontend
(`useRenderTool`) match by name, plus the same system prompt routing
rules so the LLM picks the matching tool per pill.

The frontend also registers a `highlight_note` *frontend* tool via
`useComponent`, which the LLM may emit a tool_call for; that call flows
through the AG-UI tool surface and is executed in the browser (no
backend Python is required for that one, so it's not in the tools list
here — same shape as langgraph-python).
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

from agents.shared_chat import get_model, stop_on_terminal_text


def get_weather(tool_context: ToolContext, location: str) -> dict:
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


def get_stock_price(tool_context: ToolContext, ticker: str) -> dict:
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


def get_revenue_chart(tool_context: ToolContext) -> dict:
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


# System prompt mirrored from
# `showcase/integrations/langgraph-python/src/agents/headless_complete.py`
# so the routing heuristics are identical across showcases. Keep these in
# sync if the LGP version evolves.
_INSTRUCTION = (
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


headless_complete_agent = LlmAgent(
    name="HeadlessCompleteAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[get_weather, get_stock_price, get_revenue_chart],
    after_model_callback=stop_on_terminal_text,
)
