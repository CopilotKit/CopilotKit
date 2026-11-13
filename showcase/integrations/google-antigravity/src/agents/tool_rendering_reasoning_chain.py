"""Tool Rendering (Reasoning Chain): chained tool calls on a reasoning model.

Same tools as langgraph-python's ``tool_rendering_reasoning_chain_agent.py``
(``roll_dice`` instead of the plain tool-rendering demo's ``roll_d20``), so
the page's catch-all renderer and the probe's ``data-tool-name`` selectors
apply unchanged. ``get_weather``, ``search_flights`` and ``get_stock_price``
are the tool-rendering demo's, reused as-is.
"""

from random import randint

from agents._common import REASONING_MODEL, build
from agents.tool_rendering import get_stock_price, get_weather, search_flights

SYSTEM_PROMPT = (
    "You are a helpful travel & lifestyle concierge with mock tools for "
    "weather, flights, stock prices, and dice rolls — they all return "
    "fake data, so call them liberally.\n\n"
    "Your habit is to CHAIN tools when one answer naturally invites "
    "another. For a single user question, call at least TWO tools in "
    "succession when the topic allows, then compose your final reply. "
    "Default chains:\n"
    "  - 'What's the weather in <city>?' -> call get_weather(<city>), "
    "then call search_flights(origin='SFO', destination=<city>) so the "
    "user also sees how to get there.\n"
    "  - 'How is <ticker> doing?' -> call get_stock_price(<ticker>), "
    "then call get_stock_price on a comparable ticker (e.g. 'MSFT' or "
    "'GOOGL') so the user can compare.\n"
    "  - 'Roll a 20-sided die' -> call roll_dice(sides=20), then call "
    "roll_dice again with a different number of sides so the user sees "
    "a contrast.\n"
    "  - 'Find flights from <a> to <b>' -> call search_flights(a, b), "
    "then call get_weather(<b>) for the destination.\n\n"
    "Only skip chaining when the user has clearly asked for a single, "
    "atomic answer and more tool calls would feel intrusive. Never "
    "fabricate data that a tool could provide."
)


def roll_dice(sides: int = 6) -> dict:
    """Roll a single die with the given number of sides."""
    return {"sides": sides, "result": randint(1, max(2, sides))}


# @region[reasoning-chain-agent]
TOOLS = [get_weather, search_flights, get_stock_price, roll_dice]


def tool_rendering_reasoning_chain_agent():
    return build(system_instructions=SYSTEM_PROMPT, tools=TOOLS, model=REASONING_MODEL)


# @endregion[reasoning-chain-agent]
