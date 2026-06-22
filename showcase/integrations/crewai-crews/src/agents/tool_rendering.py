"""CrewAI Flow backing the Tool Rendering demo.

The default ``ChatWithCrewFlow`` (used for the catch-all
``LatestAiDevelopment`` crew on "/") executes backend tools internally
without emitting AG-UI ``TOOL_CALL_START`` / ``TOOL_CALL_END`` events.
The frontend's ``useRenderTool`` hook never sees the tool call and
therefore never renders the WeatherCard.

This module bypasses the crew flow and uses a raw CrewAI ``Flow`` with
``copilotkit_stream`` -- which DOES emit AG-UI tool-call events for
every tool call in the LLM response -- so the frontend receives the
tool call and the registered ``useRenderTool`` renderer fires.

The flow mirrors the LangGraph-Python reference: it makes LLM calls in
a loop, executing backend tools (``get_weather``) locally and streaming
every response (text or tool call) through ``copilotkit_stream``.
"""

from __future__ import annotations

import json
import uuid
from typing import List, Optional

from crewai.flow.flow import Flow, start
from litellm import acompletion
from pydantic import Field

from ag_ui_crewai import CopilotKitState, copilotkit_stream

from tools import get_weather_impl


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------


class ToolRenderingState(CopilotKitState):
    """Minimal state -- just the conversation messages."""

    pass


# ---------------------------------------------------------------------------
# Tool schema (LiteLLM/OpenAI tool format)
# ---------------------------------------------------------------------------

GET_WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": (
            "Get current weather for a location.  Always call this tool "
            "when the user asks about weather.  Ensure the location is "
            "fully spelled out (e.g. 'San Francisco', not 'SF')."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city or location to get weather for.",
                }
            },
            "required": ["location"],
        },
    },
}


GET_STOCK_PRICE_TOOL = {
    "type": "function",
    "function": {
        "name": "get_stock_price",
        "description": (
            "Get a mock current price for a stock ticker.  Always call "
            "this tool when the user asks about a stock price or quote. "
            "Pass the ticker symbol verbatim (e.g. 'AAPL')."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "ticker": {
                    "type": "string",
                    "description": "The stock ticker symbol (e.g. 'AAPL').",
                },
                "price_usd": {
                    "type": "number",
                    "description": (
                        "Optional deterministic price to echo back. When "
                        "omitted, a mock price is returned."
                    ),
                },
                "change_pct": {
                    "type": "number",
                    "description": (
                        "Optional deterministic percent-change to echo back. "
                        "When omitted, a mock change is returned."
                    ),
                },
            },
            "required": ["ticker"],
        },
    },
}


def get_stock_price_impl(
    ticker: str,
    price_usd: float | None = None,
    change_pct: float | None = None,
) -> dict:
    """Return mock stock quote for the given ticker.

    Mirrors the LangGraph-Python `get_stock_price` tool shape so the
    aimock fixtures and `d5-tool-rendering-custom-catchall` probe see
    identical tool-result payloads across integrations. When
    `price_usd`/`change_pct` are supplied (e.g. by the aimock fixture
    "Quote AAPL through the wildcard renderer"), they're echoed back
    verbatim for deterministic assertions.
    """
    import random as _random

    rng = _random.Random(ticker.lower())
    return {
        "ticker": ticker.upper(),
        "price_usd": (
            round(float(price_usd), 2)
            if price_usd is not None
            else round(100 + rng.randint(0, 400) + rng.randint(0, 99) / 100, 2)
        ),
        "change_pct": (
            round(float(change_pct), 2)
            if change_pct is not None
            else round(rng.choice([-1, 1]) * (rng.randint(0, 300) / 100), 2)
        ),
    }


# ---------------------------------------------------------------------------
# Flow
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are a helpful, concise assistant.  When the user asks about "
    "weather for a location, call the `get_weather` tool.  When the "
    "user asks about a stock price or quote, call the `get_stock_price` "
    "tool with the ticker symbol.  After receiving any tool result, "
    "summarise it in a short sentence."
)

# Maximum LLM round-trips per user turn (prevents infinite loops).
_MAX_ITERATIONS = 5


class ToolRenderingFlow(Flow[ToolRenderingState]):
    """Chat flow that streams tool calls to the frontend for rendering."""

    @start()
    async def chat(self) -> None:
        system_message = {
            "role": "system",
            "content": _SYSTEM_PROMPT,
            "id": str(uuid.uuid4()) + "-system",
        }

        # Frontend-registered actions + our backend get_weather / get_stock_price tools.
        tools = [
            *self.state.copilotkit.actions,
            GET_WEATHER_TOOL,
            GET_STOCK_PRICE_TOOL,
        ]

        for _iteration in range(_MAX_ITERATIONS):
            messages = [system_message, *self.state.messages]

            response = await copilotkit_stream(
                await acompletion(
                    model="openai/gpt-4o-mini",
                    messages=messages,
                    tools=tools,
                    parallel_tool_calls=False,
                    stream=True,
                )
            )

            message = response.choices[0].message
            self.state.messages.append(message)

            tool_calls = message.get("tool_calls") or []
            if not tool_calls:
                # No tool calls -- the LLM produced a text response.
                return

            for tool_call in tool_calls:
                tool_call_id = tool_call["id"]
                tool_name = tool_call["function"]["name"]

                if tool_name == "get_weather":
                    try:
                        args = json.loads(tool_call["function"]["arguments"] or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    location = args.get("location", "Unknown")
                    result = get_weather_impl(location)
                    result_str = json.dumps(result)

                    self.state.messages.append(
                        {
                            "role": "tool",
                            "content": result_str,
                            "tool_call_id": tool_call_id,
                        }
                    )
                elif tool_name == "get_stock_price":
                    try:
                        args = json.loads(tool_call["function"]["arguments"] or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    ticker = args.get("ticker", "UNKNOWN")
                    price_usd = args.get("price_usd")
                    change_pct = args.get("change_pct")
                    stock_result = get_stock_price_impl(
                        ticker, price_usd=price_usd, change_pct=change_pct
                    )
                    self.state.messages.append(
                        {
                            "role": "tool",
                            "content": json.dumps(stock_result),
                            "tool_call_id": tool_call_id,
                        }
                    )
                else:
                    # Frontend-registered action -- placeholder result.
                    self.state.messages.append(
                        {
                            "role": "tool",
                            "content": "frontend tool -- handled client-side",
                            "tool_call_id": tool_call_id,
                        }
                    )

            # Loop back to call the LLM again with the tool results.


# Module-level singleton -- deepcopied per request by the endpoint.
tool_rendering_flow = ToolRenderingFlow()
