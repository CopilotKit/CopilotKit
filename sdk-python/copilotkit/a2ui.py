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


A2UI_OPERATIONS_KEY = "a2ui_operations"
"""The container key used to wrap A2UI operations for explicit detection."""

A2UI_ACTION_HANDLERS_KEY = "a2ui_action_handlers"
"""The key for pre-declared action handlers in the container."""


def render(
    operations: list[dict[str, Any]],
    action_handlers: dict[str, list[dict[str, Any]]] | None = None,
) -> str:
    """Wrap operations in the a2ui_operations container and serialize to JSON.

    Args:
        operations: The A2UI operations (surfaceUpdate, dataModelUpdate, beginRendering).
        action_handlers: Optional dict mapping action names to A2UI operations that
            should be applied optimistically when that action is triggered.
            Use "*" as a catch-all for any unmatched action.

    Example::

        render(
            operations=[...],
            action_handlers={
                "book_flight": [
                    surface_update(sid, BOOKED_SCHEMA),
                    begin_rendering(sid, "root"),
                ],
                "*": [
                    surface_update(sid, PROCESSING_SCHEMA),
                    begin_rendering(sid, "root"),
                ],
            },
        )
    """
    result: dict[str, Any] = {A2UI_OPERATIONS_KEY: operations}
    if action_handlers:
        result[A2UI_ACTION_HANDLERS_KEY] = action_handlers
    return json.dumps(result)


def render_dynamic(
    surfaceId: str,
    components: list[dict[str, Any]],
    root: str,
    items: list[dict[str, Any]] | None = None,
    actionHandlers: dict[str, list[dict[str, Any]]] | None = None,
) -> str:
    """Build A2UI operations from flat args and serialize — one-liner for dynamic tools.

    Parameter names use camelCase to match the LLM tool-call schema, so you
    can unpack the tool args directly::

        tool_call = response.tool_calls[0]
        return a2ui.render_dynamic(**tool_call["args"])

    Args:
        surfaceId: Unique surface identifier.
        components: A2UI component array (the schema).
        root: ID of the root component.
        items: Plain JSON array of data objects for the template.
        actionHandlers: Optional dict mapping action names to A2UI operations.
    """
    operations = [
        surface_update(surfaceId, components),
        data_model_update(surfaceId, {"items": items or []}),
        begin_rendering(surfaceId, root),
    ]
    return render(operations, action_handlers=actionHandlers)


# ---------------------------------------------------------------------------
# Dynamic A2UI prompt builder
# ---------------------------------------------------------------------------

_A2UI_JSON_SCHEMA = (Path(__file__).parent / "a2ui_json_schema.json").read_text()

DEFAULT_GENERATION_GUIDELINES = """\
Generate A2UI JSON.

## A2UI Protocol Instructions

A2UI (Agent to UI) is a protocol for rendering rich UI surfaces from agent responses.

To render a surface, you MUST send ALL messages in a SINGLE tool call, in this order:

1. **surfaceUpdate** - Define all UI components (REQUIRED)
2. **dataModelUpdate** - Set any data values (OPTIONAL)
3. **beginRendering** - Signal the client to start rendering (REQUIRED)

### Minimal Working Example

Here is the simplest possible A2UI surface - a button:

```json
[
  {
    "surfaceUpdate": {
      "surfaceId": "my-surface",
      "components": [
        {
          "id": "root",
          "component": {
            "Button": {
              "child": "btn-text",
              "action": { "name": "button_clicked" }
            }
          }
        },
        {
          "id": "btn-text",
          "component": {
            "Text": { "text": { "literalString": "Click Me" } }
          }
        }
      ]
    }
  },
  {
    "beginRendering": {
      "surfaceId": "my-surface",
      "root": "root"
    }
  }
]


CRITICAL: You MUST call the render_a2ui tool with these arguments:
- surfaceId: A unique ID for the surface (e.g. "product-comparison")
- components: The A2UI component array (schema). Use a List with
  template/dataBinding="/items" for repeating cards.
- root: The ID of the root component.
- items: Plain JSON array of data objects that populate the template.

PATH RULES FOR TEMPLATES:
Components inside a template use RELATIVE paths resolved against each item.
If List has dataBinding="/items" and item has key "name", use path="/name"
(NOT "/items/0/name" or "/items/{@key}/name").

DATA FORMAT:
The "items" key in the tool args should be a plain JSON array of objects.
Do NOT use valueMap/valueString format — just use regular JSON:
  "items": [
    {"name": "Product A", "price": "$99", "rating": "4.5/5", "description": "..."},
    {"name": "Product B", "price": "$149", "rating": "4.8/5", "description": "..."}
  ]
The system converts this to A2UI format automatically."""

DEFAULT_DESIGN_GUIDELINES = """\
Create polished, visually appealing interfaces:
- Always include a title heading (h2) for the surface, outside the List.
  Wrap in a Column: [title, list] as root.
- For card templates, create clear visual hierarchy:
  - h3 for primary text (names, titles)
  - h2 for featured numbers (prices, scores) — makes them stand out
  - caption for secondary info (ratings, categories, metadata)
  - body for descriptions
- Use Divider between logical sections within cards.
- Use Row with distribution="spaceBetween" for label-value pairs
  (e.g. "Rating" on left, "4.5/5" on right).
- Include images when relevant (logos, icons, product photos):
  - Use Image component with usageHint="smallFeature" or "avatar"
  - Prefer company logos for branded products — Google favicons are reliable:
    https://www.google.com/s2/favicons?domain=sony.com&sz=128
    https://www.google.com/s2/favicons?domain=bose.com&sz=128
  - For generic icons: https://placehold.co/128x128/EEE/999?text=🎧
  - Do NOT invent Unsplash photo-IDs — they will 404. Only use real, known URLs.
- Use horizontal List direction for side-by-side comparison cards.
- Keep cards clean — avoid clutter. Whitespace is good.
- Use consistent surfaceIds (lowercase, hyphenated).
- Column does NOT support "distribution" — only "alignment" and "gap".
  Use distribution only on Row components.
- Add Button for interactivity. Button needs child (Text ID) + action (name + context).
  Context values use path bindings like {"key": "name", "value": {"path": "/name"}}.

ACTION HANDLERS (for button interactivity):
When you include Button components, also provide an "actionHandlers" argument.
This is a dict mapping action names to arrays of A2UI operations that replace the
surface when the button is clicked (optimistic UI update).

Example: if a Button has action.name="select_item", provide:
  "actionHandlers": {
    "select_item": [
      {"surfaceUpdate": {"surfaceId": "THE-SAME-SURFACE-ID", "components": [
        {"id": "root", "component": {"Card": {"child": "confirm-col"}}},
        {"id": "confirm-col", "component": {"Column": {"children": {"explicitList": ["title", "detail"]}, "alignment": "center"}}},
        {"id": "title", "component": {"Text": {"text": {"literalString": "Selected!"}, "usageHint": "h2"}}},
        {"id": "detail", "component": {"Text": {"text": {"literalString": "Your selection has been confirmed."}, "usageHint": "body"}}}
      ]}},
      {"beginRendering": {"surfaceId": "THE-SAME-SURFACE-ID", "root": "root"}}
    ]
  }
Use the SAME surfaceId as the main surface. Match action names to Button action names.

Note: Action handler components are outside the List template, so Text components
in action handlers should use {"literalString": "..."} rather than {"path": "..."}.
(Path bindings in Button action.context are fine — those capture data at click time.)"""


def a2ui_prompt(
    generation_guidelines: str = DEFAULT_GENERATION_GUIDELINES,
    design_guidelines: str = DEFAULT_DESIGN_GUIDELINES,
) -> str:
    """Build the system prompt for dynamic A2UI generation.

    Combines the A2UI JSON schema reference with generation and design
    guidelines into a single prompt for a secondary LLM.

    Args:
        generation_guidelines: Instructions for how to call the render_a2ui
            tool, path rules, and data format.
        design_guidelines: Visual design rules, component hierarchy tips,
            and action handler patterns.

    Returns:
        Complete system prompt string.

    Example::

        from copilotkit import a2ui

        # Use defaults
        prompt = a2ui.a2ui_prompt()

        # Custom design guidelines
        prompt = a2ui.a2ui_prompt(design_guidelines="Keep it minimal.")
    """
    return f"""\
{generation_guidelines}

## JSON SCHEMA REFERENCE:
{_A2UI_JSON_SCHEMA}


## DESIGN GUIDELINES:
{design_guidelines}
"""


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
