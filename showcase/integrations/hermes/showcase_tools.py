"""Server-side demo tools for the CopilotKit showcase `hermes` integration.

These are REAL Hermes backend tools — they execute server-side inside the
agent loop (``agent.run_conversation``), exactly like langgraph-python's
backend tools. This module is vendored in the showcase integration ONLY; it
makes NO edits to Hermes core.

Mechanism (investigated in ``toolsets.py`` / ``tools/registry.py`` /
``model_tools.py``):

* ``registry.register(name=..., toolset="hermes-showcase", handler=...,
  check_fn=lambda: True)`` adds each tool to the live tool registry.
* ``toolsets.get_toolset("hermes-showcase")`` merges
  ``registry.get_tool_names_for_toolset("hermes-showcase")`` into the toolset's
  tool list (toolsets.py ~L604-609), and ``validate_toolset`` recognizes the
  registry-only toolset via ``_get_plugin_toolset_names`` (toolsets.py ~L847).
* ``model_tools._compute_tool_definitions`` calls ``resolve_toolset`` for each
  enabled toolset (model_tools.py ~L376-379) and ``registry.get_definitions``
  (~L442) — so with ``hermes-showcase`` in ``enabled_toolsets`` the model both
  SEES the tool schemas and can DISPATCH them.

So the launcher (``run_backend.py``) imports this module at startup to register
the tools, and ``HERMES_AGUI_TOOLSETS`` includes ``hermes-showcase`` so the
AG-UI adapter's per-run agent enables them via its normal toolset path.

Return shapes are DETERMINISTIC and reused verbatim from the demo pages' former
client ``useFrontendTool`` handlers, which already matched langgraph-python 1:1
so the shared cards + D5 assertions hold. Handlers return a JSON string (the
registry contract); the AG-UI adapter emits that string in a
``TOOL_CALL_RESULT`` event, and the client render function (``useRenderTool`` /
``useDefaultRenderTool``) parses it and paints the card.
"""

from __future__ import annotations

import json
from typing import Any, Dict

from tools.registry import registry


# ---------------------------------------------------------------------------
# Deterministic data builders (exact shapes from the former client handlers).
# ---------------------------------------------------------------------------


def _weather_data(location: str) -> Dict[str, Any]:
    return {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }


def _flights_data(origin: str, destination: str) -> Dict[str, Any]:
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


def _stock_data(
    ticker: str, price_usd: Any = None, change_pct: Any = None
) -> Dict[str, Any]:
    return {
        "ticker": (ticker or "").upper(),
        "price_usd": round(float(price_usd), 2) if price_usd is not None else 189.42,
        "change_pct": round(float(change_pct), 2) if change_pct is not None else 1.27,
    }


def _d20_data(value: Any = None) -> Dict[str, Any]:
    rolled = value if isinstance(value, int) and 1 <= value <= 20 else 11
    return {"sides": 20, "value": rolled, "result": rolled}


def _revenue_data() -> Dict[str, Any]:
    return {
        "title": "Quarterly revenue",
        "subtitle": "Last six months · USD thousands",
        "data": [
            {"label": "Jan", "value": 38},
            {"label": "Feb", "value": 47},
            {"label": "Mar", "value": 52},
            {"label": "Apr", "value": 49},
            {"label": "May", "value": 63},
            {"label": "Jun", "value": 71},
        ],
    }


# ---------------------------------------------------------------------------
# Tool handlers. Registry contract: ``handler(args: dict, **kwargs) -> str``
# (a JSON string). ``args`` is the model-supplied arguments dict.
# ---------------------------------------------------------------------------


def _get_weather(args: Dict[str, Any], **_kwargs: Any) -> str:
    location = (args or {}).get("location") or ""
    return json.dumps(_weather_data(location), ensure_ascii=False)


def _search_flights(args: Dict[str, Any], **_kwargs: Any) -> str:
    a = args or {}
    return json.dumps(
        _flights_data(a.get("origin") or "", a.get("destination") or ""),
        ensure_ascii=False,
    )


def _get_stock_price(args: Dict[str, Any], **_kwargs: Any) -> str:
    a = args or {}
    return json.dumps(
        _stock_data(a.get("ticker") or "", a.get("price_usd"), a.get("change_pct")),
        ensure_ascii=False,
    )


def _roll_d20(args: Dict[str, Any], **_kwargs: Any) -> str:
    return json.dumps(_d20_data((args or {}).get("value")), ensure_ascii=False)


def _get_revenue_chart(_args: Dict[str, Any], **_kwargs: Any) -> str:
    return json.dumps(_revenue_data(), ensure_ascii=False)


# ---------------------------------------------------------------------------
# Registration (runs on import).
# ---------------------------------------------------------------------------

_TOOLSET = "hermes-showcase"

# Schemas advertised to the model. Descriptions/params mirror the demo pages'
# former client tool definitions so the model calls them identically.
_TOOL_SPECS = [
    {
        "name": "get_weather",
        "handler": _get_weather,
        "emoji": "🌤️",
        "schema": {
            "name": "get_weather",
            "description": "Get the current weather for a given location.",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}},
                "required": ["location"],
            },
        },
    },
    {
        "name": "search_flights",
        "handler": _search_flights,
        "emoji": "✈️",
        "schema": {
            "name": "search_flights",
            "description": "Search mock flights from an origin airport to a destination airport.",
            "parameters": {
                "type": "object",
                "properties": {
                    "origin": {"type": "string"},
                    "destination": {"type": "string"},
                },
                "required": ["origin", "destination"],
            },
        },
    },
    {
        "name": "get_stock_price",
        "handler": _get_stock_price,
        "emoji": "📈",
        "schema": {
            "name": "get_stock_price",
            "description": "Get a mock current price for a stock ticker.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker": {"type": "string"},
                    "price_usd": {"type": "number"},
                    "change_pct": {"type": "number"},
                },
                "required": ["ticker"],
            },
        },
    },
    {
        "name": "roll_d20",
        "handler": _roll_d20,
        "emoji": "🎲",
        "schema": {
            "name": "roll_d20",
            "description": "Roll a 20-sided die.",
            "parameters": {
                "type": "object",
                "properties": {"value": {"type": "number"}},
            },
        },
    },
    {
        "name": "get_revenue_chart",
        "handler": _get_revenue_chart,
        "emoji": "📊",
        "schema": {
            "name": "get_revenue_chart",
            "description": "Get a mock six-month revenue series for a chart visualization.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def register_showcase_tools() -> None:
    """Register the showcase demo tools into the live registry (idempotent).

    ``check_fn=lambda: True`` keeps every tool unconditionally available, so the
    ``hermes-showcase`` toolset always resolves to the full set regardless of
    host environment.
    """
    for spec in _TOOL_SPECS:
        if registry.get_entry(spec["name"]) is not None:
            # Already registered (idempotent import / another owner). Leave it.
            continue
        registry.register(
            name=spec["name"],
            toolset=_TOOLSET,
            schema=spec["schema"],
            handler=spec["handler"],
            check_fn=lambda: True,
            description=spec["schema"]["description"],
            emoji=spec["emoji"],
        )


# Register on import so a plain ``import showcase_tools`` wires the tools up.
register_showcase_tools()
