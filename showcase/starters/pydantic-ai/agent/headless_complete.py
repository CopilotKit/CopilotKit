"""PydanticAI agent backing the Headless Chat (Complete) demo.

Mirrors showcase/packages/langgraph-python/src/agents/headless_complete.py.

The cell exists to prove that every CopilotKit rendering surface works
when the chat UI is composed manually (no <CopilotChatMessageView />
or <CopilotChatAssistantMessage />). To exercise those surfaces we give
this agent:

  - two mock backend tools (`get_weather`, `get_stock_price`) — rendered
    via app-registered `useRenderTool` renderers on the frontend,
  - access to a frontend-registered `useComponent` tool
    (`highlight_note`) — the agent "calls" it and the UI flows through
    the same `useRenderToolCall` path.

MCP Apps (Excalidraw) is not wired on the PydanticAI backend — see
`PARITY_NOTES.md`. The headless-complete cell is otherwise at parity.
"""

from __future__ import annotations

import json
from textwrap import dedent
from typing import Any

from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel

class EmptyState(BaseModel):
    """The headless-complete demo has no persistent per-thread state."""

    pass

SYSTEM_PROMPT = dedent(
    """
    You are a helpful, concise assistant wired into a headless chat
    surface that demonstrates CopilotKit's full rendering stack. Pick the
    right surface for each user question and fall back to plain text when
    none of the tools fit.

    Routing rules:
      - If the user asks about weather for a place, call `get_weather`
        with the location.
      - If the user asks about a stock or ticker (AAPL, TSLA, MSFT, ...),
        call `get_stock_price` with the ticker.
      - If the user asks you to highlight, flag, or mark a short note or
        phrase, call the frontend `highlight_note` tool with the text and
        a color (yellow, pink, green, or blue). Do NOT ask the user for
        the color — pick a sensible one if they didn't say.
      - Otherwise, reply in plain text.

    After a tool returns, write one short sentence summarizing the
    result. Never fabricate data a tool could provide.
    """
).strip()

agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1-mini"),
    deps_type=StateDeps[EmptyState],
    system_prompt=SYSTEM_PROMPT,
)

@agent.tool
def get_weather(
    ctx: RunContext[StateDeps[EmptyState]], location: str
) -> str:
    """Get the current weather for a given location.

    Returns a mock payload with city, temperature in Fahrenheit, humidity,
    wind speed, and conditions. Use this whenever the user asks about
    weather anywhere.
    """
    payload: dict[str, Any] = {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }
    return json.dumps(payload)

@agent.tool
def get_stock_price(
    ctx: RunContext[StateDeps[EmptyState]], ticker: str
) -> str:
    """Get a mock current price for a stock ticker.

    Returns a payload with the ticker symbol (uppercased), price in USD,
    and percentage change for the day. Use this whenever the user asks
    about a stock price.
    """
    payload: dict[str, Any] = {
        "ticker": ticker.upper(),
        "price_usd": 189.42,
        "change_pct": 1.27,
    }
    return json.dumps(payload)
