"""Langroid schemas for the shared reasoning-chain mock tools."""

import json

from langroid.agent.tool_message import ToolMessage
from pydantic import Field
from tools.reasoning_chain import flight_search_impl, stock_price_impl
from tools.roll_dice import roll_dice_impl

from agents.agent import GetWeatherTool


class SearchFlightsTool(ToolMessage):
    request: str = "search_flights"
    purpose: str = "Search mock flights between two airport codes."
    origin: str
    destination: str

    def handle(self) -> str:
        return json.dumps(flight_search_impl(self.origin, self.destination))


class StockPriceTool(ToolMessage):
    request: str = "get_stock_price"
    purpose: str = "Get a mock stock quote for a ticker."
    ticker: str
    price_usd: float | None = None
    change_pct: float | None = None

    def handle(self) -> str:
        return json.dumps(
            stock_price_impl(self.ticker, self.price_usd, self.change_pct)
        )


class RollDiceTool(ToolMessage):
    request: str = "roll_dice"
    purpose: str = "Roll a mock die with the requested number of sides."
    sides: int = Field(default=6, ge=2)

    def handle(self) -> str:
        return json.dumps(roll_dice_impl(self.sides))


CHAIN_TOOLS = (GetWeatherTool, SearchFlightsTool, StockPriceTool, RollDiceTool)
