"""Tool Rendering (Reasoning Chain) — minimal deep agent with tools."""

from __future__ import annotations

from random import choice, randint

from deepagents import create_deep_agent
from langchain.chat_models import init_chat_model
from langchain.tools import tool


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
            {"airline": "United", "flight": "UA231", "depart": "08:15", "arrive": "16:45", "price_usd": 348},
            {"airline": "Delta", "flight": "DL412", "depart": "11:20", "arrive": "19:55", "price_usd": 312},
            {"airline": "JetBlue", "flight": "B6722", "depart": "17:05", "arrive": "01:30", "price_usd": 289},
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


SYSTEM_PROMPT = (
    "You are a travel & lifestyle concierge. When a user asks a question, "
    "reason step-by-step and call 2+ tools in succession when relevant."
)

graph = create_deep_agent(
    model=init_chat_model(
        "openai:gpt-4o-mini", temperature=0, use_responses_api=False
    ),
    tools=[get_weather, search_flights, get_stock_price, roll_dice],
    system_prompt=SYSTEM_PROMPT,
)
