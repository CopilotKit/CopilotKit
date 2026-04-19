"""
LangGraph agent for the Declarative Generative UI (A2UI) demo — primary
variant using the default basic catalog.

This cell demonstrates the *minimal* A2UI integration: the runtime is wired
with `a2ui: { injectA2UITool: true, agents: ["declarative-gen-ui"] }` and the
frontend does NOT register a custom component catalog. The A2UI renderer
falls back to the built-in `basicCatalog` (Text, Image, Row, Column, Card,
Button, List, Tabs, TextField, CheckBox, Slider, Modal, etc.), and the
middleware injects the basic-catalog schema as `copilotkit.context` so the
LLM knows exactly which component names + props are available.

Flow:
1. Primary LLM (gpt-4o-mini) sees the conversation. When the user asks to
   render UI, it calls the `generate_a2ui` tool.
2. Inside `generate_a2ui`, a secondary LLM (gpt-4.1) is bound to
   `render_a2ui` with `tool_choice="render_a2ui"` so it is forced to emit a
   structured A2UI component tree. The `copilotkit.context` entries injected
   by the A2UI middleware carry the basic-catalog schema + generation /
   design guidelines.
3. The tool wraps the LLM's output as A2UI operations (createSurface,
   updateComponents, updateDataModel) and returns them via `a2ui.render(...)`.
   The middleware detects the `a2ui_operations` container in the tool result
   and forwards it to the renderer on the frontend.

For the variant that registers a *custom* client catalog (e.g. branded
Card/Metric/PrimaryButton renderers), see the sibling cell
`declarative-gen-ui-hardcoded`.

Reference:
    examples/integrations/langgraph-python/agent/src/a2ui_dynamic_schema.py
"""

from __future__ import annotations

import json
from typing import Any

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import ToolRuntime, tool
from langchain_core.messages import SystemMessage
from langchain_core.tools import tool as lc_tool
from langchain_openai import ChatOpenAI


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
        catalogId: The catalog ID. For this demo this is the basic catalog
            (injected via `copilotkit.context`) — i.e.
            ``https://a2ui.org/specification/v0_9/basic_catalog.json``.
        components: A2UI v0.9 component array (flat format). The root
            component must have id "root". Use only the component names
            listed in the provided basic-catalog schema
            (Text, Image, Row, Column, Card, Button, List, Tabs, etc.).
        data: Optional initial data model for the surface (e.g. list items
            for data-bound components).
    """
    return "rendered"


@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data using the basic catalog
    schema that the A2UI middleware has already injected as context. The
    result is returned as an `a2ui_operations` container for the middleware
    to detect.
    """
    # Drop the triggering tool call so the secondary LLM sees only the prior
    # conversation context.
    messages = runtime.state["messages"][:-1]

    # The runtime's A2UI middleware injects the available catalog + component
    # schema as `copilotkit.context` entries (basic catalog here, since the
    # frontend does NOT register a custom catalog). Concatenate them into the
    # system prompt so the secondary LLM knows which components it may use.
    context_entries = runtime.state.get("copilotkit", {}).get("context", [])
    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )

    model = ChatOpenAI(model="gpt-4.1")
    model_with_tool = model.bind_tools(
        [render_a2ui],
        tool_choice="render_a2ui",
    )

    response = model_with_tool.invoke(
        [SystemMessage(content=context_text), *messages],
    )

    if not response.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    args = response.tool_calls[0]["args"]
    surface_id = args["surfaceId"]
    # Default to the basic catalog ID — the frontend has no custom catalog
    # registered for this demo.
    catalog_id = args.get("catalogId", a2ui.BASIC_CATALOG_ID)
    components = args.get("components", [])
    data = args.get("data")

    ops = [
        a2ui.create_surface(surface_id, catalog_id=catalog_id),
        a2ui.update_components(surface_id, components),
    ]
    if data:
        ops.append(a2ui.update_data_model(surface_id, data))

    return a2ui.render(operations=ops)


SYSTEM_PROMPT = (
    "You are a demo assistant for Declarative Generative UI (A2UI). When the "
    "user asks to show or render any UI — a card, dashboard, form, chart, "
    "etc. — call the `generate_a2ui` tool. It designs the schema for you "
    "using the basic A2UI catalog (Text, Image, Row, Column, Card, Button, "
    "List, Tabs, TextField, CheckBox, Slider, Modal, etc.). Keep chat "
    "replies to one short sentence; the UI does the talking."
)

graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[generate_a2ui],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
