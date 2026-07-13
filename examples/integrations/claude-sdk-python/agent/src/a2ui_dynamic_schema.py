"""Dynamic A2UI tool — an LLM-designed dashboard.

A secondary Anthropic call designs a v0.9 A2UI surface via a structured
``render_a2ui`` tool call; the result is wrapped as ``a2ui_operations`` for the
frontend. The handler runs in this process (not the CLI subprocess), so it is
free to make its own Anthropic request.
"""

from __future__ import annotations

import json
from typing import Any

import anthropic
from claude_agent_sdk import tool
from copilotkit import a2ui

from src.model import resolve_model

CATALOG_ID = "copilotkit://app-dashboard-catalog"

# Structured-output schema handed to the secondary LLM to force one design call.
_RENDER_A2UI_TOOL: dict[str, Any] = {
    "name": "render_a2ui",
    "description": (
        "Render a dynamic A2UI v0.9 surface. Provide a components array (flat "
        "v0.9 format; the root component must have id 'root') and an optional "
        "initial data model."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "surfaceId": {"type": "string", "description": "Unique surface id."},
            "catalogId": {
                "type": "string",
                "description": f"Catalog id (use '{CATALOG_ID}').",
            },
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


@tool(
    "generate_a2ui",
    "Generate a dynamic A2UI dashboard (metrics, charts, tables, cards) based on "
    "the conversation. A secondary LLM designs the UI; it renders automatically.",
    {"context": str},
)
async def generate_a2ui(args: dict[str, Any]) -> dict[str, Any]:
    # Construct the client per call so it picks up ANTHROPIC_API_KEY /
    # ANTHROPIC_BASE_URL after the environment is loaded.
    client = anthropic.AsyncAnthropic()
    try:
        response = await client.messages.create(
            model=resolve_model(),
            max_tokens=4096,
            system=args.get("context") or "Generate a useful dashboard UI.",
            messages=[
                {
                    "role": "user",
                    "content": "Generate a dynamic A2UI dashboard based on the conversation.",
                }
            ],
            tools=[_RENDER_A2UI_TOOL],
            tool_choice={"type": "tool", "name": "render_a2ui"},
        )
    except Exception:
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps({"error": "Failed to generate A2UI dashboard"}),
                }
            ]
        }
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "render_a2ui":
            spec = dict(block.input)
            surface_id = spec.get("surfaceId", "dynamic-surface")
            ops = [
                a2ui.create_surface(
                    surface_id, catalog_id=spec.get("catalogId", CATALOG_ID)
                ),
                a2ui.update_components(surface_id, spec.get("components", []) or []),
            ]
            if spec.get("data"):
                ops.append(a2ui.update_data_model(surface_id, spec["data"]))
            return {"content": [{"type": "text", "text": a2ui.render(operations=ops)}]}
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps({"error": "LLM did not call render_a2ui"}),
            }
        ]
    }
