"""
Dynamic A2UI tool: LLM-generated UI from conversation context.
"""

from __future__ import annotations

import json
from typing import Any

from copilotkit import a2ui
from langchain.tools import ToolRuntime, tool
from langchain_core.messages import SystemMessage
from langchain_core.tools import tool as lc_tool
from langchain_openai import ChatOpenAI

CUSTOM_CATALOG_ID = "copilotkit://app-dashboard-catalog"


@lc_tool
def render_a2ui(
    surfaceId: str,
    catalogId: str,
    components: list[dict],
    data: dict | None = None,
) -> str:
    """Render a dynamic A2UI v0.9 surface."""
    return "rendered"


@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Generate dynamic A2UI components based on the conversation."""
    messages = runtime.state["messages"][:-1]
    context_entries = runtime.state.get("copilotkit", {}).get("context", [])
    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )

    model = ChatOpenAI(model="gpt-4.1")
    model_with_tool = model.bind_tools([render_a2ui], tool_choice="render_a2ui")
    response = model_with_tool.invoke([SystemMessage(content=context_text), *messages])

    if not response.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    args = response.tool_calls[0]["args"]
    surface_id = args.get("surfaceId", "dynamic-surface")
    catalog_id = args.get("catalogId", CUSTOM_CATALOG_ID)
    components = args.get("components", [])
    data = args.get("data", {})

    operations = [
      a2ui.create_surface(surface_id, catalog_id=catalog_id),
      a2ui.update_components(surface_id, components),
    ]
    if data:
        operations.append(a2ui.update_data_model(surface_id, data))

    return a2ui.render(operations=operations)
