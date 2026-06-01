"""Reasoning-capable Agno agent for the reasoning family of demos.

Backs three showcase cells:
    - agentic-chat-reasoning       (custom amber ReasoningBlock slot)
    - reasoning-default-render     (CopilotKit's built-in reasoning card)
    - tool-rendering-reasoning-chain (reasoning + sequential tool calls)

Mirrors `showcase/integrations/langgraph-python/src/agents/reasoning_agent.py`
(shared across the three reasoning demos there).

Uses reasoning=False with a custom AGUI handler in agent_server.py that
synthesizes REASONING_MESSAGE_* AG-UI events from <reasoning>...</reasoning>
XML tags in the model output. This avoids Agno's multi-call CoT loop
(which breaks aimock fixtures) while still producing the proper AG-UI
events that CopilotKit's frontend renders via the reasoningMessage slot.

For the reasoning-chain demo we also expose the same shared backend tools
(`get_weather`, `search_flights`, `get_stock_price`, `roll_dice`) as the
primary agent so the catch-all tool renderer can observe a full
reasoning -> tool call -> reasoning -> tool call chain.
"""

from __future__ import annotations

import json

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools import tool
from dotenv import load_dotenv

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


# NOTE: reasoning=False (the default) is used here intentionally.
#
# Agno's reasoning=True triggers a multi-call Chain-of-Thought loop that
# makes up to `reasoning_max_steps` sequential LLM calls. This breaks in
# proxy/fixture environments (aimock, D5 probes) where only the first
# call matches a fixture — subsequent calls don't match and either fall
# through to the real API (slow, non-deterministic) or fail entirely.
#
# Instead, the custom AGUI handler in agent_server.py synthesizes
# REASONING_MESSAGE_* AG-UI events from the agent's response text. The
# system prompt instructs the model to prefix its answer with a reasoning
# block delimited by <reasoning>...</reasoning> tags. The custom handler
# parses those tags and emits proper AG-UI reasoning events that
# CopilotKit's frontend renders via the reasoningMessage slot.
#
# This approach:
#   - Works with aimock (single LLM call)
#   - Emits proper AG-UI REASONING_MESSAGE_* events (unlike Agno's stock
#     AGUI handler which only emits STEP_STARTED/STEP_FINISHED)
#   - Keeps the demo visually identical to native reasoning models
agent = Agent(
    model=OpenAIChat(id="gpt-4o-mini", timeout=120),
    tools=[get_weather, search_flights, get_stock_price, roll_dice],
    reasoning=False,
    tool_call_limit=10,
    description=(
        "You are a helpful assistant. For each user question, first think "
        "step-by-step about the approach, then answer concisely. When the "
        "question calls for a tool, call it explicitly rather than guessing."
    ),
    instructions="""
        REASONING STYLE:
        Always begin your response with a reasoning block wrapped in
        <reasoning>...</reasoning> XML tags. Inside the tags, think
        step-by-step (two to four short steps is plenty). After the closing
        tag, give your concise final answer. Example:

        <reasoning>
        Step 1: Identify what the user is asking.
        Step 2: Consider which tool to use.
        Step 3: Formulate the answer.
        </reasoning>

        Here is my answer...

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
