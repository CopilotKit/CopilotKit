"""Reasoning-capable CrewAI Flow with backend-rendered tools."""

from __future__ import annotations

from copy import deepcopy
import json
import os
import random
import uuid
from typing import Any

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
from agents.responses_reasoning import ResponsesReasoningCapture
from tools import get_weather_impl


REASONING_MODEL = os.environ.get("OPENAI_REASONING_MODEL", "gpt-5.4")
SYSTEM_PROMPT = (
    "You are a travel and lifestyle concierge. Think through the request, "
    "then use the mock tools for weather, flights, stock comparisons, or "
    "dice. CRITICAL: Chain every tool needed to complete the user's full "
    "request before finishing with a concise answer. Explicit chains: "
    "compare AAPL with MSFT by calling get_stock_price for AAPL and then "
    "MSFT; roll a d20 and a smaller die by calling roll_dice with 20 and "
    "then 6; for flights from SFO to JFK plus destination weather, call "
    "search_flights for SFO/JFK and then get_weather for New York. Never "
    "stop after only the first tool in one of these requests."
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


async def _stream_with_snapshot_reasoning(
    flow: "ToolRenderingReasoningFlow",
    response: Any,
):
    """Persist this run's reasoning so the terminal snapshot cannot drop it.

    ``ag-ui-crewai`` streams reasoning events correctly, but its authoritative
    method-finish ``MESSAGES_SNAPSHOT`` only contains
    ``flow.state.messages``. Capturing the same normalized LiteLLM deltas keeps
    the current trace in that snapshot while continuing to use the SDK's native
    ``copilotkit_stream`` event lifecycle.
    """

    captured = ResponsesReasoningCapture(response)
    result = await copilotkit_stream(captured)
    reasoning = "".join(captured.reasoning_parts)
    if reasoning:
        flow.state.messages.append(
            {
                "id": str(uuid.uuid4()),
                "role": "reasoning",
                "content": reasoning,
            }
        )
    return result


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


def _get(item: Any, key: str, default: Any = None) -> Any:
    """Read mappings and LiteLLM's dict-like response models uniformly."""

    getter = getattr(item, "get", None)
    if callable(getter):
        return getter(key, default)
    return getattr(item, key, default)


def _required_chain_step(
    messages: list[Any],
) -> tuple[str, str, dict[str, Any]] | None:
    """Return a missing second leg for one of the demo's explicit chains."""

    user_text = "\n".join(
        str(_get(message, "content") or "")
        for message in messages
        if _get(message, "role") == "user"
    ).lower()
    completed: list[tuple[str, dict[str, Any]]] = []
    for message in messages:
        if _get(message, "role") != "assistant":
            continue
        for call in _get(message, "tool_calls") or []:
            function = _get(call, "function") or {}
            raw_arguments = _get(function, "arguments") or "{}"
            try:
                arguments = json.loads(raw_arguments)
            except (TypeError, json.JSONDecodeError) as exc:
                raise ValueError(
                    "Reasoning tool history contains invalid JSON arguments "
                    f"for {_get(function, 'name') or 'unknown tool'}"
                ) from exc
            completed.append((str(_get(function, "name") or ""), arguments))

    if "aapl" in user_text and "msft" in user_text:
        tickers = {
            str(arguments.get("ticker") or "").upper()
            for name, arguments in completed
            if name == "get_stock_price"
        }
        for ticker in ("AAPL", "MSFT"):
            if ticker not in tickers:
                return (
                    "get_stock_price",
                    f"Continue the requested comparison now: call "
                    f"get_stock_price with ticker exactly {ticker}.",
                    {"ticker": ticker},
                )

    if "20-sided" in user_text and "smaller" in user_text:
        sides = {
            int(arguments.get("sides", 0))
            for name, arguments in completed
            if name == "roll_dice"
        }
        for required_sides in (20, 6):
            if required_sides not in sides:
                return (
                    "roll_dice",
                    f"Continue the requested dice comparison now: call "
                    f"roll_dice with sides exactly {required_sides}.",
                    {"sides": required_sides},
                )

    if "sfo" in user_text and "jfk" in user_text and "weather" in user_text:
        names = {name for name, _arguments in completed}
        if "search_flights" not in names:
            return (
                "search_flights",
                "Continue the requested travel chain now: call search_flights "
                "with origin SFO and destination JFK.",
                {"origin": "SFO", "destination": "JFK"},
            )
        if "get_weather" not in names:
            return (
                "get_weather",
                "Continue the requested travel chain now: call get_weather "
                "for New York (JFK).",
                {"location": "New York"},
            )

    return None


def _tools_for_required_step(
    tools: list[dict[str, Any]],
    required_step: tuple[str, str, dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    if not required_step:
        return tools

    scoped_tools = deepcopy(tools)
    for tool in scoped_tools:
        function = tool.get("function") or {}
        if function.get("name") != required_step[0]:
            continue
        parameters = function.get("parameters") or {}
        properties = parameters.get("properties") or {}
        scoped_properties = {}
        for argument, value in required_step[2].items():
            if argument in properties:
                scoped_properties[argument] = deepcopy(properties[argument])
                scoped_properties[argument]["enum"] = [value]
        function["parameters"] = {
            "type": "object",
            "properties": scoped_properties,
            "required": list(scoped_properties),
            "additionalProperties": False,
        }
        function["strict"] = True
        break
    return scoped_tools


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
            required_step = (
                _required_chain_step(self.state.messages) if _iteration else None
            )
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                *[
                    message
                    for message in self.state.messages
                    if _get(message, "role") != "reasoning"
                ],
            ]
            response = await _stream_with_snapshot_reasoning(
                self,
                await copilotkit_responses(
                    model=f"openai/{REASONING_MODEL}",
                    messages=messages,
                    tools=_tools_for_required_step(tools, required_step),
                    reasoning={"effort": "medium", "summary": "detailed"},
                    parallel_tool_calls=False,
                    tool_choice=(
                        "required"
                        if _iteration == 0
                        else (
                            {"type": "function", "name": required_step[0]}
                            if required_step
                            else "auto"
                        )
                    ),
                ),
            )
            message = response.choices[0].message
            self.state.messages.append(message)
            calls = message.get("tool_calls") or []
            if not calls:
                return

            for call in calls:
                tool_call_id = call["id"]
                function = call["function"]
                raw_arguments = function.get("arguments") or "{}"
                try:
                    arguments = json.loads(raw_arguments)
                except (TypeError, json.JSONDecodeError) as exc:
                    raise ValueError(
                        "Reasoning tool call contains invalid JSON arguments "
                        f"for {function.get('name') or 'unknown tool'}"
                    ) from exc

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
