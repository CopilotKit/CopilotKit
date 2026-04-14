"""
Dynamic A2UI tool: LLM-generated UI from conversation context.

A secondary LLM generates v0.9 A2UI components via a structured tool call.
The generate_a2ui tool wraps the output as a2ui_operations, which the
middleware detects in the TOOL_CALL_RESULT and renders automatically.
"""

from __future__ import annotations

import json
import time
from typing import Any

from langchain.tools import tool, ToolRuntime
from langchain_core.tools import tool as lc_tool
from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI

import sys
import os

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"),
)
from tools import (
    build_a2ui_operations_from_tool_call,
)

CUSTOM_CATALOG_ID = "copilotkit://app-dashboard-catalog"


@lc_tool
def render_a2ui(
    surfaceId: str,
    catalogId: str,
    components: list[dict],
    data: dict | None = None,
) -> str:
    """Render a dynamic A2UI v0.9 surface.

    Args:
        surfaceId: Unique surface identifier.
        catalogId: The catalog ID (use "copilotkit://app-dashboard-catalog").
        components: A2UI v0.9 component array (flat format). The root
            component must have id "root".
        data: Optional initial data model for the surface (e.g. form values,
            list items for data-bound components).
    """
    return "rendered"


@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.
    """
    t0 = time.time()
    print(f"[A2UI-DEBUG] generate_a2ui STARTED at t=0")

    messages = runtime.state["messages"][:-1]
    print(f"[A2UI-DEBUG]   messages count: {len(messages)}")

    # Get context entries from copilotkit state (catalog capabilities + component schema)
    context_entries = runtime.state.get("copilotkit", {}).get("context", [])
    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )
    print(
        f"[A2UI-DEBUG]   context entries: {len(context_entries)}, context_text_len: {len(context_text)}"
    )

    prompt = context_text

    model = ChatOpenAI(model="gpt-4.1")
    model_with_tool = model.bind_tools(
        [render_a2ui],
        tool_choice="render_a2ui",
    )

    print(f"[A2UI-DEBUG]   calling secondary LLM at t={time.time()-t0:.1f}s")
    response = model_with_tool.invoke(
        [SystemMessage(content=prompt), *messages],
    )
    print(f"[A2UI-RESPONSE] {response}")
    print(f"[A2UI-DEBUG]   secondary LLM responded at t={time.time()-t0:.1f}s")

    if not response.tool_calls:
        print(f"[A2UI-DEBUG]   ERROR: no tool calls in response")
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.tool_calls[0]
    args = tool_call["args"]

    result = build_a2ui_operations_from_tool_call(args)
    print(
        f"[A2UI-DEBUG] generate_a2ui DONE at t={time.time()-t0:.1f}s result_len={len(json.dumps(result))}"
    )
    return json.dumps(result)
