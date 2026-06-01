"""AG2 agent for the Tool Rendering (Reasoning Chain) demo.

A travel & lifestyle concierge that chains 2+ tool calls in succession
when relevant. The frontend wires renderers for `get_weather` and
`search_flights` plus a custom catch-all for the rest.

Note: AG2's ConversableAgent does not natively emit AG-UI
REASONING_MESSAGE_* events the way LangGraph's `deepagents` does, so the
reasoning slot may not show streaming "thinking…" text. The cell still
exercises the full tool-rendering chain and the custom reasoning slot
plumbing — the slot simply renders empty/skeletal until/if a reasoning
event arrives.
"""

from __future__ import annotations

import json
from random import choice, randint
from typing import Annotated

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from fastapi import FastAPI


async def get_weather(
    location: Annotated[str, "City or place to look up the weather for"],
) -> dict:
    """Get the current weather for a given location."""
    return {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }


async def search_flights(
    origin: Annotated[str, "Origin airport code, e.g. 'SFO'"],
    destination: Annotated[str, "Destination airport code, e.g. 'JFK'"],
) -> str:
    """Search mock flights from an origin airport to a destination."""
    payload = {
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
    return json.dumps(payload)


async def get_stock_price(
    ticker: Annotated[str, "Stock ticker symbol (e.g. AAPL, TSLA, MSFT)"],
) -> dict:
    """Get a mock current price for a stock ticker."""
    return {
        "ticker": ticker.upper(),
        "price_usd": round(100 + randint(0, 400) + randint(0, 99) / 100, 2),
        "change_pct": round(choice([-1, 1]) * (randint(0, 300) / 100), 2),
    }


async def roll_dice(
    sides: Annotated[int, "Number of sides on the die (default 6)"] = 6,
) -> dict:
    """Roll a single die with the given number of sides."""
    return {"sides": sides, "result": randint(1, max(2, sides))}


SYSTEM_PROMPT = (
    "You are a travel & lifestyle concierge. When a user asks a question, "
    "reason step-by-step and call 2+ tools in succession when relevant. "
    "For weather + travel questions, call get_weather then search_flights. "
    "Keep the final summary to one short sentence."
)


agent = ConversableAgent(
    name="tool_rendering_reasoning_chain_assistant",
    system_message=SYSTEM_PROMPT,
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    max_consecutive_auto_reply=10,
    functions=[get_weather, search_flights, get_stock_price, roll_dice],
)

stream = AGUIStream(agent)
tool_rendering_reasoning_chain_app = FastAPI()
tool_rendering_reasoning_chain_app.mount("", stream.build_asgi())
