"""
A2UI helpers — build A2UI operations from schema + data.

Usage:
    from copilotkit import a2ui

    schema = a2ui.load_schema("flight_card.json")

    @tool
    def search_flights(flights: list[Flight]) -> str:
        return a2ui.render([
            a2ui.surface_update("my-surface", schema),
            a2ui.data_model_update("my-surface", {"flights": flights}),
            a2ui.begin_rendering("my-surface", "root"),
        ])
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_schema(path: str | Path) -> list[dict[str, Any]]:
    """Load an A2UI component schema from a JSON file."""
    with open(path) as f:
        return json.load(f)


def surface_update(
    surface_id: str,
    components: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a surfaceUpdate operation."""
    return {
        "surfaceUpdate": {
            "surfaceId": surface_id,
            "components": components,
        }
    }


def data_model_update(
    surface_id: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    """Build a dataModelUpdate operation from a plain Python dict."""
    normalized = _normalize_for_list_binding(data)
    contents = [{"key": k, **_to_typed_value(v)} for k, v in normalized.items()]
    return {
        "dataModelUpdate": {
            "surfaceId": surface_id,
            "contents": contents,
        }
    }


def begin_rendering(
    surface_id: str,
    root: str,
) -> dict[str, Any]:
    """Build a beginRendering operation."""
    return {
        "beginRendering": {
            "surfaceId": surface_id,
            "root": root,
        }
    }


def render(operations: list[dict[str, Any]]) -> str:
    """Wrap operations in the a2ui_operations container and serialize to JSON."""
    return json.dumps({"a2ui_operations": operations})


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _to_typed_value(value: Any) -> dict[str, Any]:
    """Convert a Python value to an A2UI typed entry."""
    if isinstance(value, bool):
        return {"valueBoolean": value}
    if isinstance(value, str):
        return {"valueString": value}
    if isinstance(value, (int, float)):
        return {"valueNumber": value}
    if isinstance(value, dict):
        return {"valueMap": [{"key": k, **_to_typed_value(v)} for k, v in value.items()]}
    if isinstance(value, list):
        return {"valueMap": [{"key": str(i), **_to_typed_value(item)} for i, item in enumerate(value)]}
    return {"valueString": str(value)}


def _normalize_for_list_binding(data: dict[str, Any]) -> dict[str, Any]:
    """Wrap single dicts in arrays so list-binding templates work uniformly."""
    out = {}
    for k, v in data.items():
        if isinstance(v, dict):
            out[k] = [v]
        else:
            out[k] = v
    return out
