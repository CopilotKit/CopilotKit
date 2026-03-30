"""
A2UI helpers — build v0.9 A2UI operations from schema + data.

Usage:
    from copilotkit import a2ui

    schema = a2ui.load_schema("flight_card.json")

    @tool
    def search_flights(flights: list[Flight]) -> str:
        return a2ui.render([
            a2ui.create_surface("my-surface"),
            a2ui.update_components("my-surface", schema),
            a2ui.update_data_model("my-surface", {"flights": flights}),
        ])
"""

from __future__ import annotations

import json
from typing import Any


def load_schema(path: str | Path) -> list[dict[str, Any]]:
    """Load an A2UI component schema from a JSON file."""
    with open(path) as f:
        return json.load(f)


def update_components(
    surface_id: str,
    components: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a v0.9 updateComponents operation."""
    return {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": surface_id,
            "components": components,
        }
    }


def update_data_model(
    surface_id: str,
    data: Any,
    path: str = "/",
) -> dict[str, Any]:
    """Build a v0.9 updateDataModel operation with plain JSON value."""
    return {
        "version": "v0.9",
        "updateDataModel": {
            "surfaceId": surface_id,
            "path": path,
            "value": data,
        }
    }


BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/basic_catalog.json"
"""The catalog ID for the standard v0.9 basic catalog."""


def create_surface(
    surface_id: str,
    catalog_id: str = BASIC_CATALOG_ID,
) -> dict[str, Any]:
    """Build a v0.9 createSurface operation."""
    return {
        "version": "v0.9",
        "createSurface": {
            "surfaceId": surface_id,
            "catalogId": catalog_id,
        }
    }


A2UI_OPERATIONS_KEY = "a2ui_operations"
"""The container key used to wrap A2UI operations for explicit detection."""


def render(
    operations: list[dict[str, Any]]
) -> str:
    """Wrap operations in the a2ui_operations container and serialize to JSON.

    Args:
        operations: The A2UI v0.9 operations (createSurface, updateComponents, updateDataModel).

    Example::
        render(
            operations=[...],
        )
    """
    result: dict[str, Any] = {A2UI_OPERATIONS_KEY: operations}
    return json.dumps(result)


# ---------------------------------------------------------------------------
# Dynamic A2UI prompt builder
# ---------------------------------------------------------------------------

DEFAULT_GENERATION_GUIDELINES = """\
Generate A2UI v0.9 JSON.

## A2UI Protocol Instructions

A2UI (Agent to UI) is a protocol for rendering rich UI surfaces from agent responses.

CRITICAL: You MUST call the render_a2ui tool with these arguments:
- surfaceId: A unique ID for the surface (e.g. "product-comparison")
- components: The A2UI component array (schema). Use a List with
  children: { componentId: "card-id", path: "/items" } for repeating cards.
- items: Plain JSON array of data objects that populate the template.
- every component must have the "component" field specifying the component type (e.g. "Text", "Image", "Row", "Column", "List", "Button", etc.)

COMPONENT ID RULES:
- Every component ID must be unique within the surface.
- A component MUST NOT reference itself as child/children. This causes a
  circular dependency error. For example, if a component has id="avatar",
  its child must be a DIFFERENT id (e.g. "avatar-img"), never "avatar".
- The child/children tree must be a DAG — no cycles allowed.

PATH RULES FOR TEMPLATES:
Components inside a repeating List use RELATIVE paths (no leading slash).
The path is resolved relative to each array item automatically.
If List has children: { componentId: "card", path: "/items" } and item has key "name",
use { "path": "name" } (NO leading slash — relative to item).
CRITICAL: Do NOT use "/name" (absolute) inside templates — use "name" (relative).
The List's own path ("/items") uses a leading slash (absolute), but all
components INSIDE the template card use paths WITHOUT leading slash.
Do NOT use "/items/0/name" or "/items/{@key}/name" — just "name".

DATA FORMAT:
The "items" key in the tool args should be a plain JSON array of objects.
Just use regular JSON — no typed wrappers needed:
  "items": [
    {"name": "Product A", "price": "$99", "rating": "4.5/5", "description": "..."},
    {"name": "Product B", "price": "$149", "rating": "4.8/5", "description": "..."}
  ]"""

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
- Use Row with justify="spaceBetween" for label-value pairs
  (e.g. "Rating" on left, "4.5/5" on right).
- Include images when relevant (logos, icons, product photos):
  - Use Image component with variant="smallFeature" or "avatar"
  - Prefer company logos for branded products — Google favicons are reliable:
    https://www.google.com/s2/favicons?domain=sony.com&sz=128
    https://www.google.com/s2/favicons?domain=bose.com&sz=128
  - For generic icons: https://placehold.co/128x128/EEE/999?text=🎧
  - Do NOT invent Unsplash photo-IDs — they will 404. Only use real, known URLs.
- Use horizontal List direction for side-by-side comparison cards.
- Keep cards clean — avoid clutter. Whitespace is good.
- Use consistent surfaceIds (lowercase, hyphenated).
- NEVER use the same ID for a component and its child — this creates a
  circular dependency. E.g. if id="avatar", child must NOT be "avatar".
- Both Row and Column support "justify" and "align".
- Add Button for interactivity. Button needs child (Text ID) + action (event).
  Use variant="primary" for main action buttons, variant="borderless" for links.
  Action context is a plain object: {"name": {"path": "name"}, "id": "static-value"}.


Use the SAME surfaceId as the main surface. Match action names to Button action event names."""


def a2ui_prompt(
    component_schema: str,
    generation_guidelines: str = DEFAULT_GENERATION_GUIDELINES,
    design_guidelines: str = DEFAULT_DESIGN_GUIDELINES,
) -> str:
    """Build the system prompt for dynamic A2UI generation.

    Args:
        component_schema: JSON string of available components and their props.
            Read from state["ag-ui"]["a2ui_schema"].
        generation_guidelines: Instructions for how to call the render_a2ui
            tool, path rules, and data format.
        design_guidelines: Visual design rules, component hierarchy tips,
            and action handler patterns.

    Returns:
        Complete system prompt string.
    """
    return f"""\
{generation_guidelines}

## DESIGN GUIDELINES:
{design_guidelines}

## AVAILABLE COMPONENTS:
The following components are available for building UI surfaces.
Use ONLY these components with the specified props.

{component_schema}
"""


    return None
