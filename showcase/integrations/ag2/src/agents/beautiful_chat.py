"""AG2 agent for the simplified Beautiful Chat demo.

This is a SIMPLIFIED port of the langgraph-python `beautiful_chat` graph.
The canonical version simultaneously exercises three big features:

1. A2UI Dynamic Schema (a `generate_a2ui` tool whose secondary LLM emits
   schema-validated component compositions).
2. Open Generative UI (the runtime auto-registers `generateSandboxedUi`
   on the frontend; the agent calls it for richer free-form widgets).
3. MCP Apps (an mcpApps server is mounted on the runtime; its tools and
   UI resources are surfaced to the agent).

For AG2 we ship the FIRST TWO surfaces in a single cell: A2UI dynamic
generation for branded, component-bound visuals (KPIs, dashboards, status
reports, simple charts) AND Open Generative UI for free-form / educational
visualisations the catalog cannot express. We deliberately leave MCP out
to keep the AG2 port focused — `/demos/mcp-apps` already covers MCP on
its own.

The agent owns `generate_a2ui` explicitly (mirroring `a2ui_dynamic.py`).
The runtime route at `src/app/api/copilotkit-beautiful-chat/route.ts`
sets `a2ui.injectA2UITool: false` so the runtime doesn't double-bind a
second A2UI tool, and turns on `openGenerativeUI` for this agent so the
runtime injects `generateSandboxedUi` on the frontend.
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


SYSTEM_PROMPT = """You are the Beautiful Chat assistant — a CopilotKit
showcase agent that answers user questions with rich, branded visuals.

You have TWO complementary visual surfaces. Pick whichever fits the
request best, but ALWAYS render something visual rather than replying
with plain text when the question warrants it.

1. `generate_a2ui` — for STRUCTURED, branded visuals composed from a
   registered React catalog. Use it for:
     - KPI dashboards (Metric + Card + Row/Column layouts)
     - Status reports (StatusBadge / Card)
     - Pie charts of part-of-whole breakdowns (PieChart)
     - Bar charts comparing categories (BarChart)
     - Info panels and quick summaries

   Pass a single `context` argument summarising the conversation; the
   secondary LLM will design the composition against the registered
   catalog (Card, StatusBadge, Metric, InfoRow, PrimaryButton,
   PieChart, BarChart, plus the basic A2UI primitives).

2. `generateSandboxedUi` — auto-registered by the frontend when Open
   Generative UI is enabled. Use it for FREE-FORM visualisations the
   catalog cannot express:
     - Educational visualisations (algorithm walkthroughs, neural-net
       activations, geometric proofs, physics simulations)
     - Custom illustrations / diagrams
     - Anything intricate that needs inline SVG, CSS animation, or an
       interactive sandboxed widget

   Output `initialHeight` (typically 480-560), a short
   `placeholderMessages` array, complete `css`, then `html` with inline
   SVG. No fetch / XHR / localStorage.

Decision rule of thumb: if the request maps to a chart, dashboard,
status report, or KPI summary, prefer `generate_a2ui`. If it asks for a
diagram, animation, or anything outside the catalog's components,
prefer `generateSandboxedUi`. Either way, keep the chat reply to one
short sentence — let the visual do the talking.
"""


async def generate_a2ui(
    context: Annotated[
        str, "Conversation context summary the secondary LLM should design UI from"
    ],
) -> str:
    """Generate dynamic A2UI components based on the conversation.

    Mirrors `a2ui_dynamic.py`: a secondary LLM is bound to the
    `render_a2ui` tool with `tool_choice` forced, and the resulting
    arguments are wrapped into an `a2ui_operations` container the
    runtime A2UI middleware detects and forwards to the frontend.
    """
    client = openai.OpenAI()
    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {
                "role": "system",
                "content": context or "Generate a useful dashboard UI.",
            },
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
    name="beautiful_chat_assistant",
    system_message=SYSTEM_PROMPT,
    llm_config=LLMConfig({"model": "gpt-4.1", "stream": True}),
    human_input_mode="NEVER",
    # The agent may call generate_a2ui (its own backend tool) and
    # generateSandboxedUi (frontend tool injected by the OGUI runtime
    # middleware). Cap the loop to keep tool storms bounded.
    max_consecutive_auto_reply=8,
    functions=[generate_a2ui],
)

stream = AGUIStream(agent)
beautiful_chat_app = FastAPI()
beautiful_chat_app.mount("", stream.build_asgi())
