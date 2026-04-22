"""Fixed-schema A2UI tool: flight search results.

Packages flight data with an A2UI schema for rendering. The schema is loaded
from the shared frontend package's flight_schema.json.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from src.agents.tools.types import Flight

_logger = logging.getLogger(__name__)

CATALOG_ID = "copilotkit://app-dashboard-catalog"
SURFACE_ID = "flight-search-results"

# Resolve the flight schema from the shared frontend package.
# Walk up from this file to showcase/shared/, then into frontend/src/a2ui/.
_SHARED_DIR = Path(__file__).resolve().parent.parent.parent  # showcase/shared/
_SCHEMA_CANDIDATES = [
    _SHARED_DIR / "frontend" / "src" / "a2ui" / "flight-schema.json",
    _SHARED_DIR / "frontend" / "src" / "a2ui" / "flight_schema.json",
]

_flight_schema: list[dict[str, Any]] | None = None
for _candidate in _SCHEMA_CANDIDATES:
    if _candidate.exists():
        with open(_candidate) as _f:
            _flight_schema = json.load(_f)
        _logger.info("Loaded flight schema from shared frontend: %s", _candidate)
        break

# Fallback: use the schema from the examples directory if present
if _flight_schema is None:
    try:
        _fallback = Path(__file__).resolve().parents[4] / (
            "examples/integrations/langgraph-python/apps/agent/src/a2ui/schemas/flight_schema.json"
        )
        if _fallback.exists():
            with open(_fallback) as _f:
                _flight_schema = json.load(_f)
            _logger.info("Loaded flight schema from examples fallback: %s", _fallback)
    except IndexError:
        # In Docker the file path is too shallow for parents[4]; skip this fallback.
        pass

# Last resort: inline minimal schema
if _flight_schema is None:
    _logger.warning("No flight schema file found, using inline minimal schema")
    _flight_schema = [
        {
            "id": "root",
            "component": "Row",
            "children": {"componentId": "flight-card", "path": "/flights"},
            "gap": 16,
        },
        {
            "id": "flight-card",
            "component": "FlightCard",
            "airline": {"path": "airline"},
            "airlineLogo": {"path": "airlineLogo"},
            "flightNumber": {"path": "flightNumber"},
            "origin": {"path": "origin"},
            "destination": {"path": "destination"},
            "date": {"path": "date"},
            "departureTime": {"path": "departureTime"},
            "arrivalTime": {"path": "arrivalTime"},
            "duration": {"path": "duration"},
            "status": {"path": "status"},
            "price": {"path": "price"},
            "action": {
                "event": {
                    "name": "book_flight",
                    "context": {
                        "flightNumber": {"path": "flightNumber"},
                        "origin": {"path": "origin"},
                        "destination": {"path": "destination"},
                        "price": {"path": "price"},
                    },
                }
            },
        },
    ]

def search_flights_impl(flights: list[Flight]) -> dict[str, Any]:
    """Package flight data with A2UI schema for rendering.

    Returns a dict with a2ui_operations that the middleware detects in the
    TOOL_CALL_RESULT and renders automatically.

    Each flight should have: airline, airlineLogo, flightNumber, origin,
    destination, date, departureTime, arrivalTime, duration, status,
    statusColor, price, currency.
    """
    return {
        "a2ui_operations": [
            {"type": "create_surface", "surfaceId": SURFACE_ID, "catalogId": CATALOG_ID},
            {"type": "update_components", "surfaceId": SURFACE_ID, "components": _flight_schema},
            {"type": "update_data_model", "surfaceId": SURFACE_ID, "data": {"flights": flights}},
        ]
    }
