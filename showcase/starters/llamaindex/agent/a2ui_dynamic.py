"""
LlamaIndex agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.

Mirrors `langgraph-python/src/agents/a2ui_dynamic.py`:

- The agent binds a single `generate_a2ui` backend tool.
- When called, `generate_a2ui` kicks off a secondary OpenAI chat completion with
  a forced `render_a2ui` tool call. The registered client catalog is expected
  to surface through the system prompt (the LlamaIndex router does not yet
  auto-inject `copilotkit.context`, so the catalog description is inlined into
  the system prompt for parity).
- The tool result returns an `a2ui_operations` container which the A2UI
  middleware on the Next.js runtime detects and forwards to the frontend
  renderer.

Pairs with the dedicated runtime route
`src/app/api/copilotkit-declarative-gen-ui/route.ts` which sets
`a2ui.injectA2UITool: false` so the runtime does not double-bind the tool.
"""

from __future__ import annotations

import json
import os
from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

from .tools import build_a2ui_operations_from_tool_call  # noqa: E402

CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog"

async def generate_a2ui(
    context: Annotated[
        str,
        "Short description of what the UI should show; mirrors the last user "
        "message so the secondary LLM has full context.",
    ],
) -> str:
    """Generate dynamic A2UI components based on the conversation.

    Invokes a secondary LLM bound to `render_a2ui` (tool_choice forced). The
    result is returned as an `a2ui_operations` container for the A2UI
    middleware to detect and forward to the frontend renderer.
    """
    from openai import OpenAI as OpenAIClient

    client = OpenAIClient()
    tool_schema = {
        "type": "function",
        "function": {
            "name": "render_a2ui",
            "description": "Render a dynamic A2UI v0.9 surface.",
            "parameters": {
                "type": "object",
                "properties": {
                    "surfaceId": {"type": "string"},
                    "catalogId": {"type": "string"},
                    "components": {"type": "array", "items": {"type": "object"}},
                    "data": {"type": "object"},
                },
                "required": ["surfaceId", "catalogId", "components"],
            },
        },
    }

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {
                "role": "system",
                "content": (
                    "You design dynamic A2UI v0.9 surfaces for the "
                    "declarative-gen-ui demo. Use catalogId "
                    f"'{CUSTOM_CATALOG_ID}'. Components: Card (title, "
                    "subtitle?, child?), StatusBadge (text, variant: "
                    "success|warning|error|info), Metric (label, value, "
                    "trend: up|down|neutral), InfoRow (label, value), "
                    "PrimaryButton (label, action?), PieChart (title, "
                    "description, data: [{label, value}]), BarChart (title, "
                    "description, data: [{label, value}]). Basic primitives "
                    "(Column, Row, Text, Image, Card, Button) are also "
                    "available. The root component id must be 'root'."
                ),
            },
            {"role": "user", "content": context or "Generate a useful dashboard UI."},
        ],
        tools=[tool_schema],
        tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
    )

    if not response.choices[0].message.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.choices[0].message.tool_calls[0]
    args = json.loads(tool_call.function.arguments)
    if not args.get("catalogId"):
        args["catalogId"] = CUSTOM_CATALOG_ID
    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)

SYSTEM_PROMPT = (
    "You are a demo assistant for Declarative Generative UI (A2UI — Dynamic "
    "Schema). Whenever a response would benefit from a rich visual — a "
    "dashboard, status report, KPI summary, card layout, info grid, a "
    "pie/donut chart of part-of-whole breakdowns, a bar chart comparing "
    "values across categories, or anything more structured than plain text — "
    "call `generate_a2ui` with a short `context` describing what to render. "
    "Keep chat replies to one short sentence; let the UI do the talking."
)

a2ui_dynamic_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[],
    backend_tools=[generate_a2ui],
    system_prompt=SYSTEM_PROMPT,
    initial_state={},
)
