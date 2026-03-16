"""
Dynamic A2UI tool: LLM-generated UI from conversation context.

The secondary LLM generates A2UI operations via a structured tool call.
Operations stream as TOOL_CALL_ARGS events. The middleware extracts
complete operations progressively and auto-injects beginRendering so
the surface renders as soon as the schema is ready.
"""

from __future__ import annotations

from typing import Any

from langchain.tools import tool, ToolRuntime
from langchain_core.messages import SystemMessage
from langchain_core.tools import tool as lc_tool
from langchain_openai import ChatOpenAI
from pathlib import Path

_SCHEMA_PROMPT_PATH = Path(__file__).parent / "a2ui" / "schemas" / "dynamic_schema_prompt.md"
SCHEMA_PROMPT = _SCHEMA_PROMPT_PATH.read_text()

SCHEMA_PROMPT += """

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
The system converts this to A2UI format automatically.

DESIGN GUIDELINES:
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
Use the SAME surfaceId as the main surface. Match action names to Button action names.
"""


@lc_tool
def render_a2ui(
    surfaceId: str,
    components: list[dict],
    root: str,
    items: list[dict],
    actionHandlers: dict | None = None,
) -> str:
    """Render a dynamic A2UI surface with progressive streaming.

    Args:
        surfaceId: Unique surface identifier.
        components: A2UI component array (the schema). Use a List with
            template/dataBinding="/items" for repeating cards.
        root: ID of the root component.
        items: Plain JSON array of data objects. Each object's keys
            correspond to the path bindings in the template components.
        actionHandlers: Optional dict mapping action names to arrays of
            A2UI operations for optimistic UI updates on button click.
    """
    return "rendered"


@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    The secondary LLM's tool call args stream as TOOL_CALL_ARGS events.
    The middleware extracts complete operations progressively.
    """
    messages = runtime.state["messages"][:-1]

    model = ChatOpenAI(model="gpt-4.1", temperature=0)
    model_with_tool = model.bind_tools(
        [render_a2ui],
        tool_choice="render_a2ui",
    )

    response = model_with_tool.invoke(
        [SystemMessage(content=SCHEMA_PROMPT), *messages],
    )

    # The render_a2ui tool call streams through LangGraph as
    # TOOL_CALL_ARGS events, which the A2UI middleware intercepts
    # and renders progressively. Return a plain ack — returning the
    # actual args would cause the middleware auto-detect to create
    # a duplicate surface.
    return "rendered"
