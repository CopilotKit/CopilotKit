"""
Fixed-schema A2UI tool: flight search results.

Emits three A2UI operations as separate messages:
  1. surfaceUpdate  — the component schema (template with data bindings)
  2. dataModelUpdate — the data contents that fill the template
  3. beginRendering  — signal the client to render

The schema is fixed (same components every time). Only the data changes
per invocation. The middleware and renderer handle each message type
independently — schema and data are separate concerns.
"""

from __future__ import annotations

import json
from typing import Any

from langchain.tools import tool
from typing_extensions import TypedDict


# ---------------------------------------------------------------------------
# Data normalization helpers
# ---------------------------------------------------------------------------

def _normalize_data_value(value: Any) -> Any:
    """Wrap a single dict in a list so list-binding templates work uniformly."""
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return value


def _normalize_data(data: dict[str, Any]) -> dict[str, Any]:
    return {k: _normalize_data_value(v) for k, v in data.items()}


# ---------------------------------------------------------------------------
# Typed data-model conversion  (Python values → A2UI contents entries)
# ---------------------------------------------------------------------------

def _to_data_model_contents(value: Any) -> dict[str, Any]:
    if isinstance(value, bool):
        return {"valueBoolean": value}
    if isinstance(value, str):
        return {"valueString": value}
    if isinstance(value, (int, float)):
        return {"valueNumber": value}
    if isinstance(value, dict):
        return {"valueMap": [_to_contents_entry(k, v) for k, v in value.items()]}
    if isinstance(value, list):
        return {"valueMap": [_to_contents_entry(str(i), item) for i, item in enumerate(value)]}
    return {"valueString": str(value)}


def _to_contents_entry(key: str, value: Any) -> dict[str, Any]:
    return {"key": key, **_to_data_model_contents(value)}


def _data_to_contents(data: dict[str, Any]) -> list[dict[str, Any]]:
    return [_to_contents_entry(k, v) for k, v in data.items()]


# ---------------------------------------------------------------------------
# Schema & tool
# ---------------------------------------------------------------------------

SURFACE_ID = "flight-search-results"


class Flight(TypedDict):
    id: str
    origin: str
    destination: str
    duration: str
    departure: str
    arrival: str
    airline: str
    flightNumber: str
    price: str


# The fixed component tree — describes layout & data bindings, never data values.
FLIGHT_SCHEMA: list[dict[str, Any]] = [
    {
        "id": "root",
        "component": {
            "List": {
                "children": {
                    "template": {
                        "componentId": "flightCard",
                        "dataBinding": "/flights",
                    }
                },
                "direction": "horizontal",
                "alignment": "start",
            }
        },
    },
    {
        "id": "flightCard",
        "component": {
            "Card": {
                "child": "flightCardContent",
            }
        },
    },
    {
        "id": "flightCardContent",
        "component": {
            "Column": {
                "children": {
                    "explicitList": [
                        "flightHeaderRow",
                        "flightRouteRow",
                        "flightTimesRow",
                        "flightDurationPriceRow",
                    ]
                },
                "distribution": "spaceAround",
                "alignment": "start",
            }
        },
    },
    # -- header: airline + flight number --
    {
        "id": "flightHeaderRow",
        "component": {
            "Row": {
                "children": {
                    "explicitList": ["airlineText", "flightNumberText"]
                },
                "distribution": "spaceBetween",
                "alignment": "center",
            }
        },
    },
    {
        "id": "airlineText",
        "component": {
            "Text": {
                "text": {"path": "/airline"},
                "usageHint": "h4",
            }
        },
    },
    {
        "id": "flightNumberText",
        "component": {
            "Text": {
                "text": {"path": "/flightNumber"},
                "usageHint": "body",
            }
        },
    },
    # -- route: origin → destination --
    {
        "id": "flightRouteRow",
        "component": {
            "Row": {
                "children": {
                    "explicitList": ["originText", "arrowIcon", "destinationText"]
                },
                "distribution": "center",
                "alignment": "center",
            }
        },
    },
    {
        "id": "originText",
        "component": {
            "Text": {
                "text": {"path": "/origin"},
                "usageHint": "h3",
            }
        },
    },
    {
        "id": "arrowIcon",
        "component": {
            "Icon": {
                "name": {"literalString": "arrowForward"},
            }
        },
    },
    {
        "id": "destinationText",
        "component": {
            "Text": {
                "text": {"path": "/destination"},
                "usageHint": "h3",
            }
        },
    },
    # -- times: departure / arrival --
    {
        "id": "flightTimesRow",
        "component": {
            "Row": {
                "children": {
                    "explicitList": ["departureText", "arrivalText"]
                },
                "distribution": "spaceBetween",
                "alignment": "center",
            }
        },
    },
    {
        "id": "departureText",
        "component": {
            "Text": {
                "text": {"path": "/departure"},
                "usageHint": "caption",
            }
        },
    },
    {
        "id": "arrivalText",
        "component": {
            "Text": {
                "text": {"path": "/arrival"},
                "usageHint": "caption",
            }
        },
    },
    # -- footer: duration + price --
    {
        "id": "flightDurationPriceRow",
        "component": {
            "Row": {
                "children": {
                    "explicitList": ["durationText", "priceText"]
                },
                "distribution": "spaceBetween",
                "alignment": "center",
            }
        },
    },
    {
        "id": "durationText",
        "component": {
            "Text": {
                "text": {"path": "/duration"},
                "usageHint": "body",
            }
        },
    },
    {
        "id": "priceText",
        "component": {
            "Text": {
                "text": {"path": "/price"},
                "usageHint": "body",
            }
        },
    },
]


@tool
def search_flights(flights: list[Flight]) -> str:
    """Search for flights and display the results as rich cards.

    Each flight must have: id, origin, destination, duration,
    departure, arrival, airline, flightNumber, and price.
    """
    # Normalize data for list binding (single dicts become single-element arrays)
    normalized = _normalize_data({"flights": flights})

    # Schema — the fixed component template (same every call)
    schema = {
        "surfaceUpdate": {
            "surfaceId": SURFACE_ID,
            "components": FLIGHT_SCHEMA,
        }
    }

    # Data — the contents that change per invocation
    data = {
        "dataModelUpdate": {
            "surfaceId": SURFACE_ID,
            "contents": _data_to_contents(normalized),
        }
    }

    # Render trigger
    render = {
        "beginRendering": {
            "surfaceId": SURFACE_ID,
            "root": "root",
        }
    }

    return json.dumps([schema, data, render])
