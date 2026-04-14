"""Dynamic A2UI tool: LLM-generated UI from conversation context.

This module provides the data preparation for a secondary LLM call that
generates v0.9 A2UI components. The actual LLM call is made by the
framework-specific wrapper (LangGraph, CrewAI, etc.) since each framework
has its own way of invoking LLMs.
"""

from __future__ import annotations

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
        "    catalogId: The catalog ID (use \"copilotkit://app-dashboard-catalog\").\n"
        "    components: A2UI v0.9 component array (flat format). "
        "The root component must have id \"root\".\n"
        "    data: Optional initial data model for the surface."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "surfaceId": {"type": "string", "description": "Unique surface identifier."},
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

def build_a2ui_operations_from_tool_call(args: dict[str, Any]) -> dict[str, Any]:
    """Build a2ui_operations dict from the secondary LLM's tool call args.

    Call this after the framework wrapper extracts the tool call arguments.
    """
    surface_id = args.get("surfaceId", "dynamic-surface")
    catalog_id = args.get("catalogId", CUSTOM_CATALOG_ID)
    components = args.get("components", [])
    if not components:
        _logger.warning("build_a2ui_operations_from_tool_call received empty components list")
    data = args.get("data")

    ops = [
        {"type": "create_surface", "surfaceId": surface_id, "catalogId": catalog_id},
        {"type": "update_components", "surfaceId": surface_id, "components": components},
    ]
    if data:
        ops.append({"type": "update_data_model", "surfaceId": surface_id, "data": data})

    return {"a2ui_operations": ops}
