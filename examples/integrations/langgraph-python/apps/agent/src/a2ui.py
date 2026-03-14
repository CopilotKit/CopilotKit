"""
A2UI helper — converts schema + data into A2UI operations JSON.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_schema(path: str | Path) -> list[dict[str, Any]]:
    """Load an A2UI component schema from a JSON file."""
    with open(path) as f:
        return json.load(f)


def _to_typed_value(value: Any) -> dict[str, Any]:
    """Convert a Python value to an A2UI typed entry (valueString, valueNumber, etc.)."""
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


def a2ui_surface(
    surface_id: str,
    root: str,
    components: list[dict[str, Any]],
    data: dict[str, Any] | None = None,
) -> str:
    """Build A2UI operations JSON from schema and data.

    Args:
        surface_id: Unique ID for this surface.
        root: ID of the root component.
        components: The component schema (template with data bindings).
        data: Optional Python dict of data to bind into the template.

    Returns:
        JSON string of A2UI operations [surfaceUpdate, dataModelUpdate?, beginRendering].
    """
    ops: list[dict[str, Any]] = []

    # Schema
    ops.append({
        "surfaceUpdate": {
            "surfaceId": surface_id,
            "components": components,
        }
    })

    # Data (if provided)
    if data is not None:
        normalized = _normalize_for_list_binding(data)
        contents = [{"key": k, **_to_typed_value(v)} for k, v in normalized.items()]
        ops.append({
            "dataModelUpdate": {
                "surfaceId": surface_id,
                "contents": contents,
            }
        })

    # Render trigger
    ops.append({
        "beginRendering": {
            "surfaceId": surface_id,
            "root": root,
        }
    })

    return json.dumps(ops)
