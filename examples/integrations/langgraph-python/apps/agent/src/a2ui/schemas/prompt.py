"""
Build the system prompt for dynamic A2UI generation.

Combines the A2UI JSON schema reference with generation guidelines
and design guidelines into a single prompt for the secondary LLM.
"""

from __future__ import annotations

from pathlib import Path

_SCHEMAS_DIR = Path(__file__).parent
_A2UI_JSON_SCHEMA = (_SCHEMAS_DIR / "a2ui_json_schema.json").read_text()

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
- Include images when relevant (product photos, avatars, icons):
  - Use Image component with usageHint="smallFeature" or "avatar"
  - Use real image URLs from Unsplash: https://images.unsplash.com/photo-ID?w=200&h=200&fit=crop
  - Or Google favicons: https://www.google.com/s2/favicons?domain=example.com&sz=128
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
Use the SAME surfaceId as the main surface. Match action names to Button action names."""


def a2ui_prompt(
    generation_guidelines: str = DEFAULT_GENERATION_GUIDELINES,
    design_guidelines: str = DEFAULT_DESIGN_GUIDELINES,
) -> str:
    """Build the full system prompt for dynamic A2UI generation.

    Args:
        generation_guidelines: Instructions for how to call the render_a2ui
            tool, path rules, and data format.
        design_guidelines: Visual design rules, component hierarchy tips,
            and action handler patterns.

    Returns:
        Complete system prompt combining the A2UI JSON schema reference
        with both sets of guidelines.
    """
    return f"""\
{generation_guidelines}

## JSON SCHEMA REFERENCE:
{_A2UI_JSON_SCHEMA}


## DESIGN GUIDELINES:
{design_guidelines}
"""
