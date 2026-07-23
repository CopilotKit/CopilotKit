"""
LangGraph agent for the CopilotKit Tool Rendering demos.

Backs the three tool-rendering cells:
  - tool-rendering-default-catchall  (no frontend renderers)
  - tool-rendering-custom-catchall   (wildcard renderer on frontend)
  - tool-rendering                   (per-tool + catch-all on frontend)

All three share this backend — they differ only in how the frontend
renders the same tool calls. The `tool-rendering-reasoning-chain` cell
has its own agent (`tool_rendering_reasoning_chain_agent.py`) because
it routes through the OpenAI Responses API for reasoning streaming.
"""

# @region[weather-tool-backend]
from random import choice, randint

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

# Multi-tool-per-question prompt.
#
# This backend serves the tool-rendering demos, whose JOB is to show the
# rendering patterns (per-tool, catch-all, default fallback). The agent
# may call multiple tools per turn when the user asks for them. The
# `roll_d20` tool accepts a deterministic `value` parameter so the
# aimock fixtures can script the exact dice sequence the e2e tests
# assert against.
SYSTEM_PROMPT = (
    "You are a travel & lifestyle concierge. Use the mock tools for "
    "weather, flights, stock prices, or d20 rolls when the user asks; "
    "otherwise reply in plain text. For flights, default origin to 'SFO' "
    "if the user only names a destination. Call multiple tools in one "
    "turn if asked. After tools return, summarize in one short sentence. "
    "Never fabricate data a tool could provide."
)


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


# @endregion[weather-tool-backend]


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


@tool
def roll_d20(value: int = 0) -> dict:
    """Roll a 20-sided die.

    The `value` argument lets the LLM (or aimock fixture) script a
    deterministic roll for testing — the tool simply echoes it back as
    the result. When called without `value` (or with 0), the tool
    returns a random natural d20 roll.
    """
    rolled = value if isinstance(value, int) and 1 <= value <= 20 else randint(1, 20)
    return {"sides": 20, "value": rolled, "result": rolled}


model = ChatOpenAI(model="gpt-5.4")

graph = create_agent(
    model=model,
    tools=[get_weather, search_flights, get_stock_price, roll_d20],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
