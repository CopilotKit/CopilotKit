"""
LangGraph agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.

Pattern (ported from the canonical
`examples/integrations/langgraph-python/agent/src/a2ui_dynamic_schema.py`):

- The agent binds an explicit `generate_a2ui` tool. When called, `generate_a2ui`
  invokes a secondary LLM bound to `render_a2ui` (tool_choice forced) with the
  registered client catalog injected as `copilotkit.context`.
- The tool result returns an `a2ui_operations` container which the A2UI
  middleware detects in the tool-call result and forwards to the frontend
  renderer.
- The runtime (see `src/app/api/copilotkit-declarative-gen-ui/route.ts`) uses
  `injectA2UITool: false` because the tool binding is owned by the agent here
  (double-injection would duplicate the tool slot).

This mirrors `beautiful_chat.py` which exercises the same pattern for the
flagship combined cell — the pattern is confirmed working there (Pie Chart
click renders a real styled doughnut).

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

CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog"

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
        catalogId: The catalog ID (use "declarative-gen-ui-catalog").
        components: A2UI v0.9 component array (flat format). The root
            component must have id "root".
        data: Optional initial data model for the surface.
    """
    return "rendered"

@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is returned as
    an `a2ui_operations` container for the A2UI middleware to detect and
    forward to the frontend renderer.
    """
    messages = runtime.state["messages"][:-1]

    # Pull the A2UI component schema + usage guidelines from the runtime's
    # `copilotkit.context` (the runtime injects them automatically when the
    # frontend registers a catalog via `<CopilotKit a2ui={{ catalog }}>`).
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

    tool_call = response.tool_calls[0]
    args = tool_call["args"]

    surface_id = args.get("surfaceId", "dynamic-surface")
    catalog_id = args.get("catalogId", CUSTOM_CATALOG_ID)
    components = args.get("components", [])
    data = args.get("data", {})

    ops = [
        a2ui.create_surface(surface_id, catalog_id=catalog_id),
        a2ui.update_components(surface_id, components),
    ]
    if data:
        ops.append(a2ui.update_data_model(surface_id, data))

    return a2ui.render(operations=ops)

SYSTEM_PROMPT = (
    "You are a demo assistant for Declarative Generative UI (A2UI — Dynamic "
    "Schema). Whenever a response would benefit from a rich visual — a "
    "dashboard, status report, KPI summary, card layout, info grid, a "
    "pie/donut chart of part-of-whole breakdowns, a bar chart comparing "
    "values across categories, or anything more structured than plain text — "
    "call `generate_a2ui` to draw it. The registered catalog includes "
    "`Card`, `StatusBadge`, `Metric`, `InfoRow`, `PrimaryButton`, `PieChart`, "
    "and `BarChart` (in addition to the basic A2UI primitives). Prefer "
    "`PieChart` for part-of-whole breakdowns (sales by region, traffic "
    "sources, portfolio allocation) and `BarChart` for comparisons across "
    "categories (quarterly revenue, headcount by team, signups per month). "
    "`generate_a2ui` takes no arguments and handles the rendering "
    "automatically. Keep chat replies to one short sentence; let the UI do "
    "the talking."
)

graph = create_agent(
    model=ChatOpenAI(model="gpt-4.1"),
    tools=[generate_a2ui],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
