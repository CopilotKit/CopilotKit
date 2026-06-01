"""Dynamic A2UI tool: LLM-generated UI from conversation context.

This module provides the data preparation for a secondary LLM call that
generates v0.9 A2UI components. The actual LLM call is made by the
framework-specific wrapper (LangGraph, CrewAI, etc.) since each framework
has its own way of invoking LLMs.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

_logger = logging.getLogger(__name__)

CUSTOM_CATALOG_ID = "copilotkit://app-dashboard-catalog"

# The render_a2ui tool schema that the secondary LLM is bound to.
RENDER_A2UI_TOOL_SCHEMA = {
    "name": "render_a2ui",
    "description": (
        "Render a dynamic A2UI v0.9 surface.\n\n"
        "Args:\n"
        "    surfaceId: Unique surface identifier.\n"
        '    catalogId: The catalog ID (use "copilotkit://app-dashboard-catalog").\n'
        "    components: A2UI v0.9 component array (flat format). "
        'The root component must have id "root".\n'
        "    data: Optional initial data model for the surface."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "surfaceId": {
                "type": "string",
                "description": "Unique surface identifier.",
            },
            "catalogId": {"type": "string", "description": "The catalog ID."},
            "components": {
                "type": "array",
                "items": {"type": "object"},
                "description": "A2UI v0.9 component array (flat format).",
            },
            "data": {
                "type": "object",
                "description": "Optional initial data model for the surface.",
            },
        },
        "required": ["surfaceId", "catalogId", "components"],
    },
}


def generate_a2ui_impl(
    messages: list[dict[str, Any]],
    context_entries: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Prepare inputs for a secondary LLM call that generates A2UI components.

    Returns a dict with:
      - system_prompt: The system prompt for the secondary LLM (built from context)
      - tool_schema: The render_a2ui tool schema to bind to the LLM
      - tool_choice: The tool name to force
      - messages: The conversation messages to pass through
      - catalog_id: The default catalog ID

    The framework wrapper should:
      1. Make an LLM call with these inputs
      2. Extract the tool call args (surfaceId, catalogId, components, data)
      3. Build a2ui_operations from the args and return them
    """
    context_text = ""
    if context_entries:
        context_text = "\n\n".join(
            entry.get("value", "")
            for entry in context_entries
            if isinstance(entry, dict) and entry.get("value")
        )

    return {
        "system_prompt": context_text,
        "tool_schema": RENDER_A2UI_TOOL_SCHEMA,
        "tool_choice": "render_a2ui",
        "messages": messages,
        "catalog_id": CUSTOM_CATALOG_ID,
    }


def _unstringify_json_fields(component: dict[str, Any]) -> dict[str, Any]:
    """Parse JSON-string fields back to Python values where the schema
    expects structured data.

    Gemini's structured-output sometimes emits `"data": "[{...}]"` (a JSON
    string) instead of `"data": [...]` (the actual array) for fields
    declared with an "any" type in the schema. The React A2UI renderer
    expects real arrays/objects on data props — strings render as
    "No data available" on charts. We round-trip those known structured
    fields through json.loads so the renderer sees the right type.

    Returns a new dict (does not mutate the input).
    """
    out = dict(component)
    for field in ("data", "value", "children"):
        v = out.get(field)
        if isinstance(v, str) and v.strip().startswith(("[", "{")):
            try:
                out[field] = json.loads(v)
            except (ValueError, TypeError):
                # Leave the raw string in place if it doesn't parse — the
                # renderer will still receive a defined value rather than
                # nothing, and downstream code can decide what to do.
                pass
    return out


def _sanitize_a2ui_components(raw: Any) -> list[dict[str, Any]]:
    """Drop entries that aren't dicts or are missing `id`/`component`,
    then unstringify any JSON-as-string fields the model emitted.

    Mirrors `langgraph-python/src/agents/_a2ui_utils.py:sanitize_a2ui_components`
    with an added pass for Gemini's stringified `data` quirk.
    """
    if not isinstance(raw, list):
        return []
    return [
        _unstringify_json_fields(c)
        for c in raw
        if isinstance(c, dict) and c.get("id") and c.get("component")
    ]


def _has_root_component(components: list[dict[str, Any]]) -> bool:
    """True iff `components` contains an entry with `id == "root"`.

    Mirrors `langgraph-python/src/agents/_a2ui_utils.py:has_root_component`.
    """
    return any(c.get("id") == "root" for c in components)


def build_a2ui_operations_from_tool_call(args: dict[str, Any]) -> dict[str, Any]:
    """Build a2ui_operations dict from the secondary LLM's tool call args.

    Call this after the framework wrapper extracts the tool call arguments.

    Emits the v0.9 NESTED operation shape that
    `@ag-ui/a2ui-middleware`'s `getOperationSurfaceId` and the React
    A2UI renderer recognize:

        { "version": "v0.9", "createSurface":   { surfaceId, catalogId } }
        { "version": "v0.9", "updateComponents": { surfaceId, components } }
        { "version": "v0.9", "updateDataModel":  { surfaceId, path, value } }

    The legacy flat shape (`{type: "create_surface", surfaceId, ...}`)
    looked plausible but the middleware's matcher only walks the nested
    `createSurface` / `updateComponents` / `updateDataModel` keys; when
    those were absent it grouped every op under the fallback `"default"`
    surface and the renderer never received the schema. Mirrors
    `copilotkit.a2ui.create_surface` / `update_components` /
    `update_data_model` from the langgraph-python north-star.
    """
    surface_id = args.get("surfaceId", "dynamic-surface")
    catalog_id = args.get("catalogId", CUSTOM_CATALOG_ID)
    # Drop empty/malformed component entries before forwarding. Without
    # this, the renderer errors on the first `undefined` id.
    components = _sanitize_a2ui_components(args.get("components", []))
    if not components:
        _logger.warning(
            "build_a2ui_operations_from_tool_call: all components were "
            "dropped by sanitization (LLM emitted empty {} entries)"
        )
    elif not _has_root_component(components):
        _logger.warning(
            "build_a2ui_operations_from_tool_call: no component with id "
            "'root' — the renderer will error with 'no root component'"
        )
    data = args.get("data")

    ops: list[dict[str, Any]] = [
        {
            "version": "v0.9",
            "createSurface": {"surfaceId": surface_id, "catalogId": catalog_id},
        },
        {
            "version": "v0.9",
            "updateComponents": {"surfaceId": surface_id, "components": components},
        },
    ]
    if data:
        ops.append(
            {
                "version": "v0.9",
                "updateDataModel": {
                    "surfaceId": surface_id,
                    "path": "/",
                    "value": data,
                },
            }
        )

    return {"a2ui_operations": ops}
