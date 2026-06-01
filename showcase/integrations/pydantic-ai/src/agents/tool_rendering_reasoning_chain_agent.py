"""Tool Rendering (Reasoning Chain) — PydanticAI agent.

Mirrors
``showcase/integrations/langgraph-python/src/agents/tool_rendering_reasoning_chain_agent.py``.

A reasoning-capable agent (gpt-5 via the Responses API) that exposes the
same shared backend tools used by the ``tool-rendering`` cell, so the
frontend cell can observe a full ``reasoning → tool call → reasoning →
tool call`` chain.

Why a reasoning model:
PydanticAI's AG-UI bridge only surfaces THINKING / REASONING events when
the underlying OpenAI Responses API returns reasoning items, which it
only does for native reasoning models. See ``reasoning_agent.py`` for
the full rationale.
"""

from __future__ import annotations

import json
import os
from random import choice, randint
from textwrap import dedent

from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import (
    OpenAIResponsesModel,
    OpenAIResponsesModelSettings,
)


SYSTEM_PROMPT = dedent(
    """
    You are a travel & lifestyle concierge. For each user question, first
    think step-by-step about the approach, then call 2+ tools in
    succession when relevant.

    Keep thinking concise — two to four short steps is plenty.

    TOOLS:
    - get_weather: use when the user asks about weather.
    - search_flights: use when the user asks about flights between
      airports. Returns mock flight options.
    - get_stock_price: use when the user asks about a ticker. Consider
      fetching a second related ticker for comparison.
    - roll_dice: use when the user asks to roll a die. Consider rolling
      twice with different numbers of sides.
    """
).strip()


_REASONING_MODEL = os.environ.get("REASONING_MODEL", "gpt-5")

agent = Agent(
    model=OpenAIResponsesModel(_REASONING_MODEL),
    model_settings=OpenAIResponsesModelSettings(
        openai_reasoning_summary="auto",
    ),
    system_prompt=SYSTEM_PROMPT,
)


@agent.tool
def get_weather(ctx: RunContext, location: str) -> str:
    """Get the current weather for a given location."""
    return json.dumps(
        {
            "city": location,
            "temperature": 68,
            "humidity": 55,
            "wind_speed": 10,
            "conditions": "Sunny",
        }
    )


@agent.tool
def search_flights(ctx: RunContext, origin: str, destination: str) -> str:
    """Search mock flights from an origin airport to a destination airport."""
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


@agent.tool
def get_stock_price(ctx: RunContext, ticker: str) -> str:
    """Get a mock current price for a stock ticker."""
    return json.dumps(
        {
            "ticker": ticker.upper(),
            "price_usd": round(100 + randint(0, 400) + randint(0, 99) / 100, 2),
            "change_pct": round(choice([-1, 1]) * (randint(0, 300) / 100), 2),
        }
    )


@agent.tool
def roll_dice(ctx: RunContext, sides: int = 6) -> str:
    """Roll a single die with the given number of sides."""
    return json.dumps({"sides": sides, "result": randint(1, max(2, sides))})
