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


def create_tool_rendering_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the tool-rendering agent (non-reasoning)."""
    base_agent = Agent(
        client=chat_client,
        name="tool_rendering_agent",
        instructions=SYSTEM_PROMPT,
        tools=[get_weather, search_flights, get_stock_price, roll_d20],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="ToolRenderingAgent",
        description=(
            "Weather + flights + stocks + d20 mock tools, multi-tool per "
            "turn, no reasoning-event emission. Drives `tool-rendering`, "
            "`tool-rendering-default-catchall`, and "
            "`tool-rendering-custom-catchall`."
        ),
    )
