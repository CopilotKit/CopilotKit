"""Reasoning-capable Agno agent for the reasoning family of demos.

Backs three showcase cells:
    - agentic-chat-reasoning       (custom amber ReasoningBlock slot)
    - reasoning-default-render     (CopilotKit's built-in reasoning card)
    - tool-rendering-reasoning-chain (reasoning + sequential tool calls)

Mirrors `showcase/packages/langgraph-python/src/agents/reasoning_agent.py`
(shared across the three reasoning demos there).

Agno's AGUI interface emits REASONING_MESSAGE_* events (see
`agno/os/interfaces/agui/utils.py`) whenever the agent produces reasoning
steps. Setting `reasoning=True` on the Agent enables Agno's built-in
agentic reasoning loop, which generates step-wise thinking visible to the
frontend via those events.

For the reasoning-chain demo we also expose the same shared backend tools
(`get_weather`, `search_flights`, `get_stock_price`, `roll_dice`) as the
primary agent so the catch-all tool renderer can observe a full
reasoning → tool call → reasoning → tool call chain.
"""

from __future__ import annotations

import json
import os
import sys

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools import tool
from dotenv import load_dotenv

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"),
)
from tools import (
    get_weather_impl,
    search_flights_impl,
)
from tools.types import Flight

load_dotenv()


@tool
def get_weather(location: str):
    """
    Get the weather for a given location. Ensure location is fully spelled out.

    Args:
        location (str): The location to get the weather for.

    Returns:
        str: Weather data as JSON.
    """
    return json.dumps(get_weather_impl(location))


@tool
def search_flights(flights: list[dict]):
    """
    Search for flights and display the results as rich A2UI cards.
    Return exactly 2 flights.

    Args:
        flights (list[dict]): List of flight objects to display.

    Returns:
        str: A2UI operations as JSON.
    """
    typed_flights = [Flight(**f) for f in flights]
    result = search_flights_impl(typed_flights)
    return json.dumps(result)


@tool
def get_stock_price(ticker: str):
    """
    Get a mock current price for a stock ticker.

    Args:
        ticker (str): The ticker symbol to look up.

    Returns:
        str: Mock price data as JSON.
    """
    from random import choice, randint

    return json.dumps(
        {
            "ticker": ticker.upper(),
            "price_usd": round(100 + randint(0, 400) + randint(0, 99) / 100, 2),
            "change_pct": round(choice([-1, 1]) * (randint(0, 300) / 100), 2),
        }
    )


@tool
def roll_dice(sides: int = 6):
    """
    Roll a single die with the given number of sides.

    Args:
        sides (int): The number of sides on the die. Defaults to 6.

    Returns:
        str: Dice roll result as JSON.
    """
    from random import randint

    return json.dumps({"sides": sides, "result": randint(1, max(2, sides))})


# A reasoning-enabled agent emits REASONING_MESSAGE_* events through the
# AGUI interface. gpt-4o-mini is cheap + fast and good enough for the
# step-by-step demonstration the showcase cell is after.
agent = Agent(
    model=OpenAIChat(id="gpt-4o-mini", timeout=120),
    tools=[get_weather, search_flights, get_stock_price, roll_dice],
    reasoning=True,
    tool_call_limit=10,
    description=(
        "You are a helpful assistant. For each user question, first think "
        "step-by-step about the approach, then answer concisely. When the "
        "question calls for a tool, call it explicitly rather than guessing."
    ),
    instructions="""
        REASONING STYLE:
        Always reason step-by-step before answering. Keep thinking concise —
        two to four short steps is plenty for most questions. Do not repeat
        the final answer inside the reasoning block.

        TOOLS (reasoning-chain cell):
        - get_weather: use when the user asks about weather.
        - search_flights: use when the user asks about flights. Generate 2
          realistic flights. Flight shape: airline, airlineLogo (Google
          favicon URL), flightNumber, origin, destination, date
          ("Tue, Mar 18"), departureTime, arrivalTime, duration ("4h 25m"),
          status ("On Time"|"Delayed"), statusColor (hex), price ("$289"),
          currency ("USD").
        - get_stock_price: use when the user asks about a ticker. Consider
          fetching a second related ticker for comparison.
        - roll_dice: use when the user asks to roll a die. Consider rolling
          twice with different numbers of sides.
    """,
)
