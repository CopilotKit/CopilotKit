"""
LangGraph agent for the CopilotKit Tool Rendering demos.

Backs the three tool-rendering cells:
  - tool-rendering-default-catchall  (no frontend renderers)
  - tool-rendering-custom-catchall   (wildcard renderer on frontend)
  - tool-rendering                   (per-tool + catch-all on frontend)
  - tool-rendering-reasoning-chain   (testing — also streams reasoning)

All cells share this backend — they differ only in how the frontend
renders the same tool calls. Kept separate from `agent.py` so the
tool-rendering demo has a tightly-scoped tool set.
"""

from random import choice, randint

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

# Multi-tool chaining prompt.
#
# The goal of this demo is to surface MULTIPLE tool-call cards per turn so
# the rendering patterns (per-tool + catch-all) get exercised visibly. The
# prompt nudges the model toward an explore-then-enrich pattern (e.g.
# `get_weather("Tokyo")` -> `search_flights(..., "Tokyo")`) without forcing
# a rigid recipe: we describe the *habit*, not a chain.
SYSTEM_PROMPT = (
    "You are a helpful travel & lifestyle concierge. You have mock tools "
    "for weather, flights, stock prices, and dice rolls - they all return "
    "fake data, so call them liberally.\n\n"
    "Your habit is to CHAIN tools when one answer naturally invites another. "
    "For a single user question, call at least TWO tools in succession when "
    "the topic allows before composing your final reply. Examples of "
    "helpful chains you should default to:\n"
    "  - 'What's the weather in Tokyo?' -> call get_weather('Tokyo'), then "
    "call search_flights(origin='SFO', destination='Tokyo') so the user "
    "also sees how to get there.\n"
    "  - 'How is AAPL doing?' -> call get_stock_price('AAPL'), then call "
    "get_stock_price on a related ticker (e.g. 'MSFT' or 'GOOGL') for "
    "comparison.\n"
    "  - 'Roll a d20' -> call roll_dice(20), then call roll_dice again with "
    "a different number of sides so the user sees a contrast.\n"
    "  - 'Find flights from SFO to JFK' -> call search_flights, then call "
    "get_weather on the destination city.\n\n"
    "Only skip chaining when the user has clearly asked for a single, "
    "atomic answer and more tool calls would feel intrusive. Never "
    "fabricate data that a tool could provide."
)


# @region[weather-tool-backend]
@tool
def get_weather(location: str) -> dict:
    """Get the current weather for a given location.

    Useful on its own for weather questions, and a great companion to
    `search_flights` - always consider checking the weather at a
    destination the user is flying to, and checking flights to any
    city whose weather the user has just asked about.
    """
    return {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }
# @endregion[weather-tool-backend]


@tool
def search_flights(origin: str, destination: str) -> dict:
    """Search mock flights from an origin airport to a destination airport.

    Pairs naturally with `get_weather`: after searching flights, check
    the weather at the destination so the user can plan. When the user
    mentions a city without a matching origin, default the origin to
    'SFO'.
    """
    return {
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


@tool
def get_stock_price(ticker: str) -> dict:
    """Get a mock current price for a stock ticker.

    When the user asks about a single ticker, consider also pulling a
    related ticker for context (e.g. if they ask about 'AAPL', also
    fetch 'MSFT' or 'GOOGL' so the reply can compare).
    """
    return {
        "ticker": ticker.upper(),
        "price_usd": round(100 + randint(0, 400) + randint(0, 99) / 100, 2),
        "change_pct": round(choice([-1, 1]) * (randint(0, 300) / 100), 2),
    }


@tool
def roll_dice(sides: int = 6) -> dict:
    """Roll a single die with the given number of sides.

    When the user asks for a roll, consider rolling twice with different
    numbers of sides so the reply can show a contrast (e.g. a d6 AND a
    d20).
    """
    return {"sides": sides, "result": randint(1, max(2, sides))}


model = ChatOpenAI(model="gpt-4o-mini")

graph = create_agent(
    model=model,
    tools=[get_weather, search_flights, get_stock_price, roll_dice],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
