"""LangGraph agent backing the Headless Chat (Complete) demo.

The cell exists to prove that every CopilotKit rendering surface works
when the chat UI is composed manually (no <CopilotChatMessageView /> or
<CopilotChatAssistantMessage />). To exercise those surfaces we give
this agent:

  - two mock backend tools (get_weather, get_stock_price) — render via
    app-registered `useRenderTool` renderers on the frontend,
  - access to a frontend-registered `useComponent` tool
    (`highlight_note`) — the agent "calls" it and the UI flows through
    the same `useRenderToolCall` path,
  - MCP Apps wired through the runtime — the agent can invoke Excalidraw
    MCP tools and the middleware emits activity events that
    `useRenderActivityMessage` picks up.

The system prompt nudges the model toward the right surface per user
question and falls back to plain text otherwise.
"""

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware


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


@tool
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


@tool
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


@tool
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


graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[get_weather, get_stock_price, get_revenue_chart],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
