"""Shared tool implementations used by every tool-rendering variant.

The four tool-rendering demos differ only in their frontend wiring; the
backend tool surface is identical. Pulled out so each per-variant agent
file can declare its own `tools=[...]` literal — that visibility is what
`scripts/validate-fixture-tool-surface.ts` relies on to detect aimock
fixture drift.

Mirrors langgraph-python's `tool_rendering_agent.py` tool surface so the
shared aimock fixtures (showcase/aimock/d5-all.json) and Playwright e2e
specs (`tool-rendering*.spec.ts`) work against both integrations.
"""

# @region[weather-tool-backend]
from __future__ import annotations

from random import choice, randint

from google.adk.tools import ToolContext


def get_weather(tool_context: ToolContext, location: str) -> dict:
    """Get the current weather for a given location."""
    return {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }


# @endregion[weather-tool-backend]


def search_flights(tool_context: ToolContext, origin: str, destination: str) -> dict:
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


def get_stock_price(
    tool_context: ToolContext,
    ticker: str,
    price_usd: float | None = None,
    change_pct: float | None = None,
) -> dict:
    """Get a mock current price for a stock ticker.

    The optional `price_usd` and `change_pct` arguments let the LLM (or
    aimock fixture) script a deterministic ticker quote for testing —
    when supplied, the tool echoes them back verbatim. When omitted (or
    `None`), the tool returns mock random values. Mirrors the
    deterministic-`value` pattern on `roll_d20`.
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


def roll_d20(tool_context: ToolContext, value: int = 0) -> dict:
    """Roll a 20-sided die.

    The `value` argument lets the LLM (or aimock fixture) script a
    deterministic roll for testing — the tool simply echoes it back as
    the result. When called without `value` (or with 0), the tool
    returns a random natural d20 roll.
    """
    rolled = value if isinstance(value, int) and 1 <= value <= 20 else randint(1, 20)
    return {"sides": 20, "value": rolled, "result": rolled}


def roll_dice(tool_context: ToolContext, sides: int = 6) -> dict:
    """Roll a single die with the given number of sides.

    Used by the reasoning-chain variant whose pills script a d20 → d6
    contrast chain. Kept alongside `roll_d20` because the aimock fixtures
    differ between the two demos (the basic tool-rendering family pins
    `roll_d20` with a deterministic `value`; the reasoning-chain demo
    pins `roll_dice` with a deterministic `sides` argument).
    """
    return {"sides": sides, "result": randint(1, max(2, sides))}


TOOL_RENDERING_INSTRUCTION = (
    "You are a travel & lifestyle concierge. Use the mock tools for "
    "weather, flights, stock prices, or d20 rolls when the user asks; "
    "otherwise reply in plain text. For flights, default origin to 'SFO' "
    "if the user only names a destination. Call multiple tools in one "
    "turn if asked. After tools return, summarize in one short sentence. "
    "Never fabricate data a tool could provide."
)


TOOL_RENDERING_REASONING_CHAIN_INSTRUCTION = (
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
    "fabricate data that a tool could provide."
)
