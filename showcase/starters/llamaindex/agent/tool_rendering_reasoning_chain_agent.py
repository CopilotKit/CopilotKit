"""
Tool Rendering + Reasoning Chain agent.

Concierge-style agent that reasons step-by-step and calls 2+ backend tools in
succession when relevant. The frontend renders the reasoning tokens via a
custom `reasoningMessage` slot and paints `get_weather` / `search_flights`
with rich cards, with every other tool falling back to a branded catch-all.

Mirrors `langgraph-python/src/agents/tool_rendering_reasoning_chain_agent.py`.
"""

from __future__ import annotations

import json
from random import choice, randint
from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

async def get_weather(
    location: Annotated[str, "Location to get the weather for."],
) -> str:
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

async def search_flights(
    origin: Annotated[str, "Origin airport code."],
    destination: Annotated[str, "Destination airport code."],
) -> str:
    """Search mock flights from an origin airport to a destination airport."""
    return json.dumps(
        {
            "origin": origin,
            "destination": destination,
            "flights": [
                {"airline": "United", "flight": "UA231", "depart": "08:15", "arrive": "16:45", "price_usd": 348},
                {"airline": "Delta", "flight": "DL412", "depart": "11:20", "arrive": "19:55", "price_usd": 312},
                {"airline": "JetBlue", "flight": "B6722", "depart": "17:05", "arrive": "01:30", "price_usd": 289},
            ],
        }
    )

async def get_stock_price(
    ticker: Annotated[str, "Stock ticker symbol."],
) -> str:
    """Get a mock current price for a stock ticker."""
    return json.dumps(
        {
            "ticker": ticker.upper(),
            "price_usd": round(100 + randint(0, 400) + randint(0, 99) / 100, 2),
            "change_pct": round(choice([-1, 1]) * (randint(0, 300) / 100), 2),
        }
    )

async def roll_dice(
    sides: Annotated[int, "Number of sides on the die."] = 6,
) -> str:
    """Roll a single die with the given number of sides."""
    return json.dumps({"sides": sides, "result": randint(1, max(2, sides))})

SYSTEM_PROMPT = (
    "You are a travel & lifestyle concierge. When a user asks a question, "
    "reason step-by-step about the approach, then call 2+ tools in succession "
    "when relevant. Keep responses concise."
)

tool_rendering_reasoning_chain_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[],
    backend_tools=[get_weather, search_flights, get_stock_price, roll_dice],
    system_prompt=SYSTEM_PROMPT,
    initial_state={},
)
