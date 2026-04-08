"""
Dynamic A2UI tool: LLM-generated UI from conversation context.

A secondary LLM generates v0.9 A2UI components via a structured tool call.
The generate_a2ui tool wraps the output as a2ui_operations, which the
middleware detects in the TOOL_CALL_RESULT and renders automatically.
"""

from __future__ import annotations

import json
from typing import Any

from langchain.tools import tool, ToolRuntime
from langchain_core.messages import SystemMessage
from langchain_core.tools import tool as lc_tool
from langchain_openai import ChatOpenAI

from copilotkit import a2ui

A2UI_GENERATION_PROMPT = a2ui.a2ui_prompt()

CUSTOM_CATALOG_ID = "https://a2ui.org/demos/dojo/custom_catalog.json"


@lc_tool
def render_a2ui(
    surfaceId: str,
    components: list[dict],
    items: list[dict],
    actionHandlers: dict | None = None,
) -> str:
    """Render a dynamic A2UI v0.9 surface.

    Args:
        surfaceId: Unique surface identifier.
        components: A2UI v0.9 component array (flat format). The root
            component must have id "root". Use a List with
            children: { componentId, path: "/items" } for repeating cards.
        items: Plain JSON array of data objects. Each object's keys
            correspond to the path bindings in the template components.
            Use relative paths (no leading /) inside templates.
        actionHandlers: Optional dict mapping action names to arrays of
            v0.9 A2UI operations for optimistic UI updates on button click.
    """
    return "rendered"


def _build_context_addendum(state: dict) -> str:
    """Extract agent context from state and format as a prompt addendum."""
    ag_ui = state.get("ag-ui", {})
    context_entries = ag_ui.get("context", [])
    if not context_entries:
        return ""
    parts = ["\n\n## Additional Context from Client:\n"]
    for entry in context_entries:
        desc = entry.get("description", "")
        value = entry.get("value", "")
        if desc:
            parts.append(f"### {desc}\n{value}\n")
        else:
            parts.append(f"{value}\n")
    return "\n".join(parts)


@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.
    """
    # The last message is this tool call (generate_a2ui) so we remove it,
    # as it is not yet balanced with a tool call response.
    messages = runtime.state["messages"][:-1]

    # Inject client-provided context (e.g. custom catalog definitions)
    context_addendum = _build_context_addendum(runtime.state)
    prompt = A2UI_GENERATION_PROMPT + context_addendum

    model = ChatOpenAI(model="gpt-4.1")
    model_with_tool = model.bind_tools(
        [render_a2ui],
        tool_choice="render_a2ui",
    )

    response = model_with_tool.invoke(
        [SystemMessage(content=prompt), *messages],
    )

    # Extract the render_a2ui tool call arguments
    if not response.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.tool_calls[0]
    args = tool_call["args"]

    surface_id = args.get("surfaceId", "dynamic-surface")
    components = args.get("components", [])
    items = args.get("items", [])
    action_handlers = args.get("actionHandlers")

    # Wrap as v0.9 a2ui_operations so the middleware detects it
    return a2ui.render(
        operations=[
            a2ui.create_surface(surface_id, catalog_id=CUSTOM_CATALOG_ID),
            a2ui.update_components(surface_id, components),
            a2ui.update_data_model(surface_id, {"items": items}),
        ],
        action_handlers=action_handlers,
    )
