"""Luna reasoning summaries through the OpenAI Responses API.

The local model wrapper supplies metadata for the pinned LlamaIndex SDK.
The reasoning router maps summary deltas to AG-UI reasoning events.
"""

import json
import os
from random import choice, randint
from typing import Annotated

from agents._openai_models import OpenAIResponses

from agents._reasoning_router import get_reasoning_ag_ui_workflow_router


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


# Reasoning-capable model routed through the OpenAI Responses API. Default
# `gpt-6-luna` (a native reasoning model LlamaIndex 0.5.6 recognizes); override via
# OPENAI_REASONING_MODEL. See reasoning_agent.py for the model-name constraint
# and why the reasoning params are passed through both reasoning_options and
# additional_kwargs.
REASONING_MODEL = os.environ.get("OPENAI_REASONING_MODEL", "gpt-6-luna")
_REASONING_PARAMS = {"effort": "medium", "summary": "detailed"}

_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]

tool_rendering_reasoning_chain_router = get_reasoning_ag_ui_workflow_router(
    llm=OpenAIResponses(
        model=REASONING_MODEL,
        reasoning_options=_REASONING_PARAMS,
        additional_kwargs={"reasoning": _REASONING_PARAMS},
        **_openai_kwargs,
    ),
    frontend_tools=[],
    backend_tools=[get_weather, search_flights, get_stock_price, roll_dice],
    system_prompt=SYSTEM_PROMPT,
    initial_state={},
)
