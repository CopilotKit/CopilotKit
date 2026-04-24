"""Tool Rendering (Reasoning Chain) agent for MS Agent Framework.

Backs the three tool-rendering showcase cells:
  - tool-rendering-default-catchall  (no frontend renderers)
  - tool-rendering-custom-catchall   (wildcard renderer on frontend)
  - tool-rendering-reasoning-chain   (per-tool + reasoning + catch-all)

The tools mirror the LangGraph `tool_rendering_agent` so the frontends
can be shared one-to-one with the LangGraph showcase. Each tool returns
a small JSON payload suitable for rich per-tool renderers on the
frontend.
"""

from __future__ import annotations

import json
import os
from random import choice, randint
from textwrap import dedent
from typing import Annotated

from agent_framework import Agent, BaseChatClient, tool
from agent_framework.openai import OpenAIChatClient
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field


@tool(
    name="get_weather",
    description=(
        "Get the current weather for a given location. Useful on its "
        "own for weather questions, and a great companion to "
        "search_flights."
    ),
)
def get_weather(
    location: Annotated[str, Field(description="The city or region to describe.")],
) -> str:
    """Return mock weather data as JSON."""
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
    name="search_flights",
    description=(
        "Search mock flights from an origin airport to a destination "
        "airport. Pairs naturally with get_weather: after searching "
        "flights, check the weather at the destination."
    ),
)
def search_flights(
    origin: Annotated[str, Field(description="Origin airport code, e.g. SFO.")],
    destination: Annotated[str, Field(description="Destination airport code, e.g. JFK.")],
) -> str:
    """Return mock flight search results as JSON."""
    return json.dumps(
        {
            "origin": origin,
            "destination": destination,
            "flights": [
                {
                    "airline": "United",
                    "flight": "UA231",
                    "depart": "08:15",
                    "arrive": "16:45",
                    "price_usd": 348,
                },
                {
                    "airline": "Delta",
                    "flight": "DL412",
                    "depart": "11:20",
                    "arrive": "19:55",
                    "price_usd": 312,
                },
                {
                    "airline": "JetBlue",
                    "flight": "B6722",
                    "depart": "17:05",
                    "arrive": "01:30",
                    "price_usd": 289,
                },
            ],
        }
    )


@tool(
    name="get_stock_price",
    description=(
        "Get a mock current price for a stock ticker. When the user "
        "asks about one ticker, consider pulling a related ticker for "
        "comparison."
    ),
)
def get_stock_price(
    ticker: Annotated[str, Field(description="Stock ticker symbol, e.g. AAPL.")],
) -> str:
    """Return mock stock price data as JSON."""
    return json.dumps(
        {
            "ticker": ticker.upper(),
            "price_usd": round(100 + randint(0, 400) + randint(0, 99) / 100, 2),
            "change_pct": round(choice([-1, 1]) * (randint(0, 300) / 100), 2),
        }
    )


@tool(
    name="roll_dice",
    description=(
        "Roll a single die with the given number of sides. Consider "
        "rolling twice with different sides so the reply can show a "
        "contrast."
    ),
)
def roll_dice(
    sides: Annotated[int, Field(description="Number of sides on the die.")] = 6,
) -> str:
    """Return a mock dice roll as JSON."""
    return json.dumps({"sides": sides, "result": randint(1, max(2, sides))})


SYSTEM_PROMPT = dedent(
    """
    You are a helpful travel & lifestyle concierge. You have mock tools
    for weather, flights, stock prices, and dice rolls — they all return
    fake data, so call them liberally.

    Your habit is to CHAIN tools when one answer naturally invites
    another. For a single user question, call at least TWO tools in
    succession when the topic allows before composing your final reply.
    Examples of helpful chains you should default to:
      - "What's the weather in Tokyo?" -> call get_weather("Tokyo"), then
        call search_flights(origin="SFO", destination="Tokyo") so the user
        also sees how to get there.
      - "How is AAPL doing?" -> call get_stock_price("AAPL"), then call
        get_stock_price on a related ticker (e.g. "MSFT" or "GOOGL") for
        comparison.
      - "Roll a d20" -> call roll_dice(20), then call roll_dice again with
        a different number of sides so the user sees a contrast.
      - "Find flights from SFO to JFK" -> call search_flights, then call
        get_weather on the destination city.

    Between tool calls, briefly narrate your reasoning so the user can
    follow along. Only skip chaining when the user has clearly asked for
    a single, atomic answer. Never fabricate data that a tool could
    provide.
    """
).strip()


def create_tool_rendering_reasoning_chain_agent(
    chat_client: BaseChatClient,
) -> AgentFrameworkAgent:
    """Instantiate the tool-rendering reasoning-chain demo agent."""
    base_agent = Agent(
        client=chat_client,
        name="tool_rendering_reasoning_chain_agent",
        instructions=SYSTEM_PROMPT,
        tools=[get_weather, search_flights, get_stock_price, roll_dice],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="ToolRenderingReasoningChainAgent",
        description=(
            "Travel & lifestyle concierge that chains tool calls "
            "(weather, flights, stocks, dice) for tool-rendering demos."
        ),
        require_confirmation=False,
    )


def build_default_chat_client() -> BaseChatClient:
    """Create a default OpenAI chat client from environment variables."""
    if not os.getenv("OPENAI_API_KEY"):
        raise ValueError("OPENAI_API_KEY environment variable is required")
    return OpenAIChatClient(
        model=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
        api_key=os.getenv("OPENAI_API_KEY"),
    )
