"""Reasoning-capable CrewAI Flow with backend-rendered tools."""

from __future__ import annotations

import json
import os
import random

from crewai.flow.flow import Flow, start

from ag_ui_crewai import (
    CopilotKitState,
    copilotkit_emit_tool_result,
    copilotkit_responses,
    copilotkit_stream,
)

from agents.tool_rendering import (
    GET_STOCK_PRICE_TOOL,
    GET_WEATHER_TOOL,
    get_stock_price_impl,
)
from tools import get_weather_impl


REASONING_MODEL = os.environ.get("OPENAI_REASONING_MODEL", "gpt-5.4")
SYSTEM_PROMPT = (
    "You are a travel and lifestyle concierge. Think through the request, "
    "then use the mock tools for weather, flights, stock comparisons, or "
    "dice. Chain tools when useful and finish with a concise answer."
)

SEARCH_FLIGHTS_TOOL = {
    "type": "function",
    "function": {
        "name": "search_flights",
        "description": "Search mock flights between two airports.",
        "parameters": {
            "type": "object",
            "properties": {
                "origin": {"type": "string"},
                "destination": {"type": "string"},
            },
            "required": ["origin", "destination"],
        },
    },
}
ROLL_DICE_TOOL = {
    "type": "function",
    "function": {
        "name": "roll_dice",
        "description": "Roll one die with the requested number of sides.",
        "parameters": {
            "type": "object",
            "properties": {"sides": {"type": "integer", "minimum": 2}},
            "required": ["sides"],
        },
    },
}


def _search_flights(origin: str, destination: str) -> dict:
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


class ToolRenderingReasoningFlow(Flow[CopilotKitState]):
    """Stream reasoning, tool calls, backend results, and final text."""

    @start()
    async def chat(self) -> None:
        tools = [
            GET_WEATHER_TOOL,
            SEARCH_FLIGHTS_TOOL,
            GET_STOCK_PRICE_TOOL,
            ROLL_DICE_TOOL,
        ]
        for _iteration in range(8):
            response = await copilotkit_stream(
                await copilotkit_responses(
                    model=f"openai/{REASONING_MODEL}",
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        *self.state.messages,
                    ],
                    tools=tools,
                    reasoning={"effort": "medium", "summary": "detailed"},
                )
            )
            message = response.choices[0].message
            self.state.messages.append(message)
            calls = message.get("tool_calls") or []
            if not calls:
                return

            for call in calls:
                tool_call_id = call["id"]
                function = call["function"]
                try:
                    arguments = json.loads(function.get("arguments") or "{}")
                except (TypeError, json.JSONDecodeError):
                    arguments = {}

                name = function["name"]
                if name == "get_weather":
                    result = get_weather_impl(arguments.get("location", "Unknown"))
                elif name == "search_flights":
                    result = _search_flights(
                        arguments.get("origin", "SFO"),
                        arguments.get("destination", "JFK"),
                    )
                elif name == "get_stock_price":
                    result = get_stock_price_impl(
                        arguments.get("ticker", "UNKNOWN"),
                        price_usd=arguments.get("price_usd"),
                        change_pct=arguments.get("change_pct"),
                    )
                elif name == "roll_dice":
                    sides = max(2, int(arguments.get("sides", 6)))
                    result = {"sides": sides, "result": random.randint(1, sides)}
                else:
                    result = {"error": f"Unknown backend tool: {name}"}

                content = json.dumps(result)
                self.state.messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": content,
                    }
                )
                await copilotkit_emit_tool_result(tool_call_id, content)


tool_rendering_reasoning_flow = ToolRenderingReasoningFlow()
