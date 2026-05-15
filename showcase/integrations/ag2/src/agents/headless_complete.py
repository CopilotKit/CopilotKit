"""AG2 agent backing the Headless Chat (Complete) demo.

The cell exists to prove that every CopilotKit rendering surface works
when the chat UI is composed manually (no <CopilotChatMessageView /> or
<CopilotChatAssistantMessage />). To exercise those surfaces we give
this agent two mock backend tools (``get_weather``, ``get_stock_price``)
which the frontend renders via app-registered ``useRenderTool``
renderers, plus a frontend-registered ``useComponent`` tool
(``highlight_note``) that the agent can invoke -- the UI flows through
the same ``useRenderToolCall`` path.

The system prompt nudges the model toward the right surface per user
question and falls back to plain text otherwise.
"""

from __future__ import annotations

from typing import Annotated

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from fastapi import FastAPI


SYSTEM_PROMPT = (
    "You are a helpful, concise assistant wired into a headless chat "
    "surface that demonstrates CopilotKit's full rendering stack. Pick "
    "the right surface for each user question and fall back to plain "
    "text when none of the tools fit.\n\n"
    "Routing rules:\n"
    "  - If the user asks about weather for a place, call `get_weather` "
    "with the location.\n"
    "  - If the user asks about a stock or ticker (AAPL, TSLA, MSFT, "
    "...), call `get_stock_price` with the ticker.\n"
    "  - If the user asks you to highlight, flag, or mark a short note "
    "or phrase, call the frontend `highlight_note` tool with the text "
    "and a color (yellow, pink, green, or blue). Do NOT ask the user "
    "for the color -- pick a sensible one if they didn't say.\n"
    "  - Otherwise, reply in plain text.\n\n"
    "After a tool returns, write one short sentence summarizing the "
    "result. Never fabricate data a tool could provide."
)


async def get_weather(
    location: Annotated[str, "City or place to look up the weather for"],
) -> dict:
    """Get the current weather for a given location.

    Returns a mock payload with city, temperature in Fahrenheit, humidity,
    wind speed, and conditions.
    """
    return {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }


async def get_stock_price(
    ticker: Annotated[str, "Stock ticker symbol (e.g. AAPL, TSLA, MSFT)"],
) -> dict:
    """Get a mock current price for a stock ticker.

    Returns a payload with the ticker symbol (uppercased), price in USD,
    and percentage change for the day.
    """
    return {
        "ticker": ticker.upper(),
        "price_usd": 189.42,
        "change_pct": 1.27,
    }


agent = ConversableAgent(
    name="headless_complete_assistant",
    system_message=SYSTEM_PROMPT,
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    max_consecutive_auto_reply=8,
    functions=[get_weather, get_stock_price],
)

stream = AGUIStream(agent)
headless_complete_app = FastAPI()
headless_complete_app.mount("", stream.build_asgi())
