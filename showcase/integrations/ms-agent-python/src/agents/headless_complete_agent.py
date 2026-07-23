"""MAF agent backing the Headless Chat (Complete) demo.

Mirrors the LangGraph reference at
`showcase/integrations/langgraph-python/src/agents/headless_complete.py`.
Three deterministic mock tools (`get_weather`, `get_stock_price`,
`get_revenue_chart`) feed the four headless pills the e2e spec drives.
"""

from __future__ import annotations

import json
from textwrap import dedent
from typing import Annotated

from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field


@tool(
    name="get_weather",
    description=(
        "Get the current weather for a given location. Returns city, "
        "temperature (F), humidity, wind, and conditions."
    ),
)
def get_weather(
    location: Annotated[str, Field(description="City or region name.")],
) -> str:
    """Return mock weather data as JSON. Deterministic for testing."""
    return json.dumps(
        {
            "city": location,
            "temperature": 68,
            "humidity": 55,
            "wind_speed": 10,
            "conditions": "Sunny",
        }
    )


@tool(
    name="get_stock_price",
    description=(
        "Get a mock current price for a stock ticker. Returns ticker, "
        "price_usd, and change_pct."
    ),
)
def get_stock_price(
    ticker: Annotated[str, Field(description="Stock ticker symbol.")],
) -> str:
    """Return mock stock data as JSON. Deterministic for testing."""
    return json.dumps(
        {
            "ticker": ticker.upper(),
            "price_usd": 189.42,
            "change_pct": 1.27,
        }
    )


@tool(
    name="get_revenue_chart",
    description=(
        "Get a mock six-month revenue series for a chart visualization. "
        "Returns title, subtitle, and an array of {label, value} points."
    ),
)
def get_revenue_chart() -> str:
    """Return a deterministic six-month revenue series."""
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


SYSTEM_PROMPT = dedent(
    """
    You are a helpful, concise assistant wired into a headless chat
    surface that demonstrates CopilotKit's full rendering stack. Pick the
    right surface for each user question and fall back to plain text when
    none of the tools fit.

    Routing rules:
      - If the user asks about weather for a place, call `get_weather`
        with the location.
      - If the user asks about a stock or ticker (AAPL, TSLA, MSFT, ...),
        call `get_stock_price` with the ticker.
      - If the user asks for a chart, graph, or visualization of revenue,
        sales, or other metrics over time, call `get_revenue_chart`.
      - If the user asks you to highlight, flag, or mark a short note or
        phrase, call the frontend `highlight_note` tool with the text and
        a color (yellow, pink, green, or blue). Do NOT ask the user for
        the color — pick a sensible one if they didn't say.
      - Otherwise, reply in plain text.

    After a tool returns, write one short sentence summarizing the
    result. Never fabricate data a tool could provide.
    """
).strip()


def create_headless_complete_agent(
    chat_client: BaseChatClient,
) -> AgentFrameworkAgent:
    """Instantiate the headless-complete MAF agent."""
    base_agent = Agent(
        client=chat_client,
        name="headless_complete_agent",
        instructions=SYSTEM_PROMPT,
        tools=[get_weather, get_stock_price, get_revenue_chart],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="HeadlessCompleteAgent",
        description=(
            "Mock weather, stock, and chart tools for the Headless Chat "
            "(Complete) demo."
        ),
    )
