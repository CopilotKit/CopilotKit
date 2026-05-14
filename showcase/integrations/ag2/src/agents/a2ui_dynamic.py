"""AG2 agent for the Declarative Generative UI (A2UI Dynamic Schema) demo.

Mirrors the langgraph-python `a2ui_dynamic.py` pattern: the agent owns the
`generate_a2ui` tool explicitly. When called, it invokes a secondary LLM
bound to `render_a2ui` (tool_choice forced) using the registered client
catalog injected via the runtime's `copilotkit.context`. The tool result
returns an `a2ui_operations` container which the runtime's A2UI middleware
detects and forwards to the frontend renderer.

The dedicated runtime route (`api/copilotkit-declarative-gen-ui/route.ts`)
sets `injectA2UITool: false` so the runtime does not double-bind a second
A2UI tool on top of this one.
"""

from __future__ import annotations

import json
import os
from typing import Annotated

import openai
from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from fastapi import FastAPI

from tools import (
    build_a2ui_operations_from_tool_call,
    RENDER_A2UI_TOOL_SCHEMA,
)


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
    "`generate_a2ui` takes a single `context` argument summarising the "
    "conversation. Keep chat replies to one short sentence; let the UI do "
    "the talking."
)


async def generate_a2ui(
    context: Annotated[
        str, "Conversation context summary the secondary LLM should design UI from"
    ],
) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data using the `render_a2ui`
    tool schema. The result is returned as an `a2ui_operations` container
    for the runtime A2UI middleware to detect and forward to the frontend.
    """
    client = openai.OpenAI()
    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {"role": "system", "content": context or "Generate a useful dashboard UI."},
            {
                "role": "user",
                "content": "Generate a dynamic A2UI dashboard based on the conversation.",
            },
        ],
        tools=[
            {
                "type": "function",
                "function": RENDER_A2UI_TOOL_SCHEMA,
            }
        ],
        tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
    )

    choice = response.choices[0]
    if choice.message.tool_calls:
        args = json.loads(choice.message.tool_calls[0].function.arguments)
        result = build_a2ui_operations_from_tool_call(args)
        return json.dumps(result)

    return json.dumps({"error": "LLM did not call render_a2ui"})


agent = ConversableAgent(
    name="declarative_gen_ui_assistant",
    system_message=SYSTEM_PROMPT,
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    max_consecutive_auto_reply=8,
    functions=[generate_a2ui],
)

stream = AGUIStream(agent)
a2ui_dynamic_app = FastAPI()
a2ui_dynamic_app.mount("", stream.build_asgi())
