"""Tool Rendering (Reasoning Chain) — minimal deep agent with tools.

Routes through a reasoning-capable OpenAI model via the Responses API
so the chain of thought streams as AG-UI REASONING_MESSAGE_* events
alongside the tool calls. See `reasoning_agent.py` for the rationale.
"""

from __future__ import annotations

import os
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

    The optional `price_usd` and `change_pct` arguments let the LLM (or
    aimock fixture) script a deterministic ticker quote for testing —
    when supplied, the tool echoes them back verbatim. Mirrors the
    basic tool-rendering agent's signature so the aimock fixtures shared
    across both demos can script chained AAPL/MSFT comparisons.
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
    """Roll a single die with the given number of sides."""
    return {"sides": sides, "result": randint(1, max(2, sides))}


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
    "fabricate data that a tool could provide."
)

REASONING_MODEL = os.environ.get("OPENAI_REASONING_MODEL", "gpt-5.4")

# No CopilotKitMiddleware — this demo combines reasoning-token streaming with
# backend tool rendering, but doesn't consume any frontend tools or app context.
# The frontend renders the tool calls via `useRenderTool`, which works off the
# AG-UI tool-call event stream and doesn't require server-side middleware.
graph = create_deep_agent(
    model=init_chat_model(
        f"openai:{REASONING_MODEL}",
        use_responses_api=True,
        # `summary: "detailed"` forces reasoning-summary emission on every
        # response. The previous `"auto"` lets the model decide, and with
        # tools present the model often skips reasoning summaries entirely
        # (the chain-of-thought goes straight to a tool call without the
        # summary step). That breaks the `<ReasoningBlock>` mount because
        # no reasoning-role message lands. Match the working
        # `reasoning_agent.py` config: medium effort + detailed summary.
        reasoning={"effort": "medium", "summary": "detailed"},
    ),
    tools=[get_weather, search_flights, get_stock_price, roll_dice],
    system_prompt=SYSTEM_PROMPT,
)
