"""
Tool Rendering — primary (per-tool + catch-all) variant.

Same backend tools as the `tool-rendering-default-catchall` and
`tool-rendering-custom-catchall` cells. The frontend for this cell
shows the most sophisticated pattern: per-tool custom renderers for
`get_weather` and `search_flights` (rich, branded UI), with a
wildcard catch-all for the remaining tools.
"""

from random import choice, randint

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

SYSTEM_PROMPT = (
    "You are a demo agent. Call tools freely in response to user requests. "
    "Prefer tools over guessing; the tools all return mock data."
)


@tool
def get_weather(location: str) -> dict:
    """Get the current weather for a given location."""
    return {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }


@tool
def search_flights(origin: str, destination: str) -> dict:
    """Search mock flights from an origin airport to a destination airport."""
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
    """Get a mock current price for a stock ticker."""
    return {
        "ticker": ticker.upper(),
        "price_usd": round(100 + randint(0, 400) + randint(0, 99) / 100, 2),
        "change_pct": round(choice([-1, 1]) * (randint(0, 300) / 100), 2),
    }


@tool
def roll_dice(sides: int = 6) -> dict:
    """Roll a single die with the given number of sides."""
    return {"sides": sides, "result": randint(1, max(2, sides))}


model = ChatOpenAI(model="gpt-4o-mini")

graph = create_agent(
    model=model,
    tools=[get_weather, search_flights, get_stock_price, roll_dice],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
