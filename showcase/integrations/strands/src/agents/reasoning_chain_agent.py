"""Tool Rendering (Reasoning Chain): reasoning summaries plus chained tools.

Same Responses-API reasoning model as `reasoning_agent.py`, with the four mock
tools the demo's per-tool renderers paint: `get_weather`, `search_flights`,
`get_stock_price` and `roll_dice`. Each pill drives a chained pair of calls, so
the agent must own every tool in the chain to reach the closing narration.

Tools are defined here rather than in `showcase/shared/python/tools` because
this demo needs its own stock and dice shapes; the shared showcase agent keeps
its own copies for the basic tool-rendering demos.

Mirrors `langgraph-python/src/agents/tool_rendering_reasoning_chain_agent.py`.
"""

from __future__ import annotations

from random import choice, randint

from strands import Agent, tool
from ag_ui_strands import StrandsAgent

from agents.reasoning_agent import build_reasoning_model


@tool
def get_weather(location: str) -> dict:
    """Get the current weather for a given location.

    Args:
        location: City or airport to report on.
    """
    return {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }


@tool
def search_flights(origin: str, destination: str) -> dict:
    """Search mock flights from an origin airport to a destination airport.

    Args:
        origin: Origin airport code.
        destination: Destination airport code.
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
def get_stock_price(
    ticker: str,
    price_usd: float | None = None,
    change_pct: float | None = None,
) -> dict:
    """Get a mock current price for a stock ticker.

    The optional arguments let the model (or an aimock fixture) script a
    deterministic quote: when supplied they are echoed back verbatim.

    Args:
        ticker: Ticker symbol to quote.
        price_usd: Optional scripted price.
        change_pct: Optional scripted percentage change.
    """
    return {
        "ticker": ticker.upper(),
        "price_usd": (
            round(float(price_usd), 2)
            if price_usd is not None
            else round(100 + randint(0, 400) + randint(0, 99) / 100, 2)
        ),
        "change_pct": (
            round(float(change_pct), 2)
            if change_pct is not None
            else round(choice([-1, 1]) * (randint(0, 300) / 100), 2)
        ),
    }


@tool
def roll_dice(sides: int = 6) -> dict:
    """Roll a single die with the given number of sides.

    Args:
        sides: Number of faces on the die.
    """
    return {"sides": sides, "result": randint(1, max(2, sides))}


SYSTEM_PROMPT = (
    "You are a helpful travel & lifestyle concierge with mock tools for "
    "weather, flights, stock prices, and dice rolls -- they all return "
    "fake data, so call them liberally.\n\n"
    "Your habit is to CHAIN tools when one answer naturally invites "
    "another. For a single user question, call at least TWO tools in "
    "succession when the topic allows, then compose your final reply. "
    "Default chains:\n"
    "  - 'What's the weather in <city>?' -> call get_weather(<city>), "
    "then call search_flights(origin='SFO', destination=<city>) so the "
    "user also sees how to get there.\n"
    "  - 'How is <ticker> doing?' -> call get_stock_price(<ticker>), "
    "then call get_stock_price on a comparable ticker (e.g. 'MSFT' or "
    "'GOOGL') so the user can compare.\n"
    "  - 'Roll a 20-sided die' -> call roll_dice(sides=20), then call "
    "roll_dice again with a different number of sides so the user sees "
    "a contrast.\n"
    "  - 'Find flights from <a> to <b>' -> call search_flights(a, b), "
    "then call get_weather(<b>) for the destination.\n\n"
    "Only skip chaining when the user has clearly asked for a single, "
    "atomic answer and more tool calls would feel intrusive. Never "
    "fabricate data that a tool could provide."
)


def build_reasoning_chain_agent() -> StrandsAgent:
    """Construct the StrandsAgent backing tool-rendering-reasoning-chain."""
    strands_agent = Agent(
        model=build_reasoning_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=[get_weather, search_flights, get_stock_price, roll_dice],
    )
    return StrandsAgent(
        agent=strands_agent,
        name="reasoning_chain",
        description=(
            "Strands agent that chains mock tools while streaming reasoning summaries"
        ),
    )
