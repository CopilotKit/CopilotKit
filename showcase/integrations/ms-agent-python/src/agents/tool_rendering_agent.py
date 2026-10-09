"""Tool Rendering agent — backs the three tool-rendering cells.

Mirrors LangGraph's `langgraph-python/src/agents/tool_rendering_agent.py`:
this agent serves
  - `tool-rendering`                — per-tool + catch-all on frontend
  - `tool-rendering-default-catchall` — no frontend renderers
  - `tool-rendering-custom-catchall`  — wildcard renderer on frontend

All three share this backend; they differ only in how the frontend
renders the same tool calls. The `tool-rendering-reasoning-chain` cell
is intentionally NOT served by this agent — it has its own variant
(`tool_rendering_reasoning_chain_agent.py`) that routes through the
OpenAI Responses API for reasoning streaming. Mixing reasoning events
into the catchall renderers breaks the default-catchall cell's spec
because the built-in default-renderer doesn't paint reasoning blocks.

Tool surface is identical to the reasoning-chain variant — get_weather,
search_flights, get_stock_price, roll_d20 — sourced via direct imports
from that module so the two agents can never drift apart.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Any

from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent

from agents.tool_rendering_reasoning_chain_agent import (
    get_stock_price,
    get_weather,
    roll_d20,
    search_flights,
)


SYSTEM_PROMPT = dedent(
    """
    You are a travel & lifestyle concierge. Use the mock tools for
    weather, flights, stock prices, or d20 rolls when the user asks;
    otherwise reply in plain text. For flights, default origin to 'SFO'
    if the user only names a destination. Call multiple tools in one
    turn if the user asks for them. After tools return, summarize in
    one short sentence. Never fabricate data a tool could provide.
    """
).strip()


class _ToolRenderingFrameworkAgent(AgentFrameworkAgent):
    """Drop the trailing MESSAGES_SNAPSHOT for tool-rendering turns.

    The base adapter emits the tool call inside an empty TEXT_MESSAGE and the
    follow-up narration as a SEPARATE assistant message, then closes the run
    with a MESSAGES_SNAPSHOT echoing that multi-message shape. With the custom
    wildcard renderer that snapshot re-render lands the tool-call bubble last,
    so the D6 turn-scoped `ctx.text` selector reads the tool card instead of the
    narration (`tool-rendering-custom-catchall` content-phrase check fails).
    Dropping the snapshot lets the frontend keep the stream-built message order
    (narration last), matching langgraph. Same mechanism as the multimodal
    subclass; the event stream is otherwise unchanged, and the plain +
    default-catchall cells (which don't hinge on that selector) are unaffected.
    """

    async def run(self, input_data: dict[str, Any]):  # type: ignore[override]
        from ag_ui.core import EventType

        async for event in super().run(input_data):
            if getattr(event, "type", None) == EventType.MESSAGES_SNAPSHOT:
                continue
            yield event


def create_tool_rendering_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the tool-rendering agent (non-reasoning)."""
    base_agent = Agent(
        client=chat_client,
        name="tool_rendering_agent",
        instructions=SYSTEM_PROMPT,
        tools=[get_weather, search_flights, get_stock_price, roll_d20],
    )

    return _ToolRenderingFrameworkAgent(
        agent=base_agent,
        name="ToolRenderingAgent",
        description=(
            "Weather + flights + stocks + d20 mock tools, multi-tool per "
            "turn, no reasoning-event emission. Drives `tool-rendering`, "
            "`tool-rendering-default-catchall`, and "
            "`tool-rendering-custom-catchall`."
        ),
    )
