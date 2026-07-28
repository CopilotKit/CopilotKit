"""Tool Rendering (Reasoning Chain) — reasoning model + backend tools.

Mirrors LangGraph Python's
``showcase/integrations/langgraph-python/src/agents/tool_rendering_reasoning_chain_agent.py``.

Backs the ``tool-rendering-reasoning-chain`` showcase cell: sequential
tool calls (weather / flights / stocks / dice) rendered by per-tool +
catch-all frontend renderers, with reasoning tokens streaming alongside
via the custom ``reasoningMessage`` slot.

Uses the same reasoning-model path as ``reasoning_agent.py`` (Chat
Completions + ``OPENAI_REASONING_MODEL``). See that module's B6/B8 note
for the Responses-API gap vs LGP — same constraint applies here.

Tool signatures match the frontend ``useRenderTool`` registrations in
``src/app/demos/tool-rendering-reasoning-chain/page.tsx``:

  * get_weather(location) → weather JSON
  * search_flights(origin, destination) → {origin, destination, flights[]}
  * get_stock_price / roll_dice → catch-all renderer

Aimock header forwarding is global (``agents._header_forwarding`` via
agent_server); nothing agent-local is required.
"""

from __future__ import annotations

import json
from random import choice, randint

from strands import Agent, tool
from ag_ui_strands import StrandsAgent

from agents.reasoning_agent import SYSTEM_PROMPT as _REASONING_STYLE, _build_reasoning_model
from tools import get_weather_impl, roll_dice_impl


@tool
def get_weather(location: str):
    """Get the current weather for a given location.

    Args:
        location: The city or region to describe.

    Returns:
        Weather data as a JSON string.
    """
    return json.dumps(get_weather_impl(location))


@tool
def search_flights(origin: str, destination: str):
    """Search mock flights from an origin airport to a destination airport.

    Args:
        origin: Origin airport code, e.g. SFO.
        destination: Destination airport code, e.g. JFK.

    Returns:
        Flight search results as a JSON string.
    """
    # Shape matches LGP tool_rendering_reasoning_chain_agent + the
    # FlightListCard frontend (origin/destination + simple flights[]).
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


@tool
def get_stock_price(
    ticker: str,
    price_usd: float | None = None,
    change_pct: float | None = None,
):
    """Get a mock current price for a stock ticker.

    The optional ``price_usd`` and ``change_pct`` arguments let the LLM
    (or aimock fixture) script a deterministic ticker quote for testing —
    when supplied, the tool echoes them back verbatim. Mirrors the LGP
    tool-rendering agent's signature so shared fixtures can script
    chained AAPL/MSFT comparisons.

    Args:
        ticker: Stock ticker symbol, e.g. AAPL.
        price_usd: Deterministic price; None = random mock.
        change_pct: Deterministic change percent; None = random mock.

    Returns:
        Mock price data as a JSON string.
    """
    return json.dumps(
        {
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
    )


@tool
def roll_dice(sides: int = 6):
    """Roll a single die with the given number of sides.

    Args:
        sides: Number of sides on the die (e.g. 20 for a d20). Defaults to 6.

    Returns:
        Dice roll result as a JSON string.
    """
    return json.dumps(roll_dice_impl(max(2, int(sides))))


SYSTEM_PROMPT = (
    "You are a helpful travel & lifestyle concierge with mock tools for "
    "weather, flights, stock prices, and dice rolls — they all return "
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
    "fabricate data that a tool could provide.\n\n"
    # Keep the pure-reasoning style as a secondary habit so reasoning
    # models that surface CoT still narrate briefly between tool legs.
    f"{_REASONING_STYLE}"
)


def build_tool_rendering_reasoning_chain_agent() -> StrandsAgent:
    """Construct the tool-rendering reasoning-chain StrandsAgent.

    Same reasoning-model path as ``build_reasoning_agent``, plus the four
    backend tools the frontend renderers expect. Mounting lands in the
    wire-server (B6) slot.
    """
    strands_agent = Agent(
        model=_build_reasoning_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=[get_weather, search_flights, get_stock_price, roll_dice],
    )

    return StrandsAgent(
        agent=strands_agent,
        name="tool_rendering_reasoning_chain_agent",
        description=(
            "Travel & lifestyle concierge that chains tool calls "
            "(weather, flights, stocks, dice) with reasoning tokens for "
            "the tool-rendering-reasoning-chain demo."
        ),
    )
