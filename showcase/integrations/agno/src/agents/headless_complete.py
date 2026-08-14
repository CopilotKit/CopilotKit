"""Thin Agno agent for the Headless Chat (Complete) demo.

LGP shape: backend weather / stock / revenue-chart tools, plus a frontend
`highlight_note` tool. Agno only forwards a tool call when the name is on
the agent, so highlight_note is declared external_execution.
"""

import json

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools import tool
from dotenv import load_dotenv

load_dotenv()


@tool
def get_weather(location: str):
    """Get the current weather for a given location."""
    return json.dumps(
        {
            "city": location,
            "temperature": 68,
            "humidity": 55,
            "wind_speed": 10,
            "conditions": "Sunny",
        }
    )


@tool
def get_stock_price(ticker: str):
    """Get a mock current price for a stock ticker."""
    return json.dumps(
        {
            "ticker": ticker.upper(),
            "price_usd": 189.42,
            "change_pct": 1.27,
        }
    )


@tool
def get_revenue_chart():
    """Get a mock six-month revenue series for a chart."""
    return json.dumps(
        {
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
    )


@tool(external_execution=True)
def highlight_note(text: str, color: str = "yellow"):
    """Highlight a short note in yellow, pink, green, or blue.

    Args:
        text (str): Note text to highlight.
        color (str): yellow, pink, green, or blue.
    """


agent = Agent(
    model=OpenAIChat(id="gpt-4o", timeout=120),
    tools=[get_weather, get_stock_price, get_revenue_chart, highlight_note],
    tool_call_limit=8,
    description=("You are a concise assistant on a headless chat surface."),
    instructions="""
        If the user asks about weather, call get_weather.
        If the user asks about a stock or ticker, call get_stock_price.
        If the user asks for a chart of revenue or sales, call get_revenue_chart.
        If the user asks to highlight or flag a short note, call highlight_note
        with the text and a color. Do not ask for the color.
        After a tool returns, write one short sentence.
    """,
)
