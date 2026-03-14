"""
Fixed-schema A2UI tool: flight search results.

The schema (component template) is fixed — same every call.
Only the data changes per invocation.
"""

from __future__ import annotations

from typing import Any

from langchain.tools import tool
from typing_extensions import TypedDict

from src.a2ui import a2ui_surface


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
    return a2ui_surface(
        surface_id=SURFACE_ID,
        root="root",
        components=FLIGHT_SCHEMA,
        data={"flights": flights},
    )
