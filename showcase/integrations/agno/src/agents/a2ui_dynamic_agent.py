"""Agno agent for the Declarative Generative UI (A2UI Dynamic Schema) demo.

Mirrors the langgraph-python `a2ui_dynamic.py` pattern: the agent owns the
`generate_a2ui` tool explicitly. When called, it invokes a secondary
OpenAI client bound to `render_a2ui` (tool_choice forced) using the
registered client catalog injected via the runtime's
`state.copilotkit.context`. The tool result returns an `a2ui_operations`
container which the runtime's A2UI middleware detects and forwards to the
frontend renderer.

Why a separate agent (vs reusing the main agent's `generate_a2ui` tool)?
The main agent uses a hardcoded internal catalog ID
(`copilotkit://app-dashboard-catalog`) and ignores any runtime catalog the
frontend registers via `<CopilotKit a2ui={{ catalog }}>`. This dedicated
agent reads the runtime catalog from `session_state["copilotkit"]
["context"]` so it stays in sync with the frontend renderer's catalog.

The dedicated runtime route (`api/copilotkit-declarative-gen-ui/route.ts`)
sets `injectA2UITool: false` so the runtime does not double-bind a second
A2UI tool on top of this one.
"""

from __future__ import annotations

import json

import openai
from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.run import RunContext
from dotenv import load_dotenv

from tools import (
    build_a2ui_operations_from_tool_call,
    RENDER_A2UI_TOOL_SCHEMA,
)

load_dotenv()


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


def generate_a2ui(run_context: RunContext, context: str) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an `a2ui_operations` container for the A2UI middleware
    to detect and forward to the frontend renderer.

    The runtime A2UI middleware injects the registered client catalog
    schema into `state.copilotkit.context` automatically. We pull it out
    of the per-run `session_state` (Agno's `validate_agui_state` mirrors
    `RunAgentInput.state` into `session_state`) so the secondary LLM
    knows which components are available — staying in sync with the
    frontend catalog.

    Args:
        run_context: Agno run context (provides session_state).
        context (str): Conversation context summary the secondary LLM
            should design UI from.

    Returns:
        str: A2UI operations as JSON.
    """
    state = getattr(run_context, "session_state", None) or {}
    context_entries = []
    if isinstance(state, dict):
        ck = state.get("copilotkit") or {}
        if isinstance(ck, dict):
            entries = ck.get("context") or []
            if isinstance(entries, list):
                context_entries = entries

    context_text_parts: list[str] = []
    for entry in context_entries:
        if isinstance(entry, dict):
            value = entry.get("value")
            if isinstance(value, str) and value:
                context_text_parts.append(value)
    catalog_context = "\n\n".join(context_text_parts)

    system_prompt = (
        catalog_context if catalog_context else "Generate a useful dashboard UI."
    )
    if context and context.strip():
        system_prompt = f"{system_prompt}\n\nConversation context:\n{context}"

    client = openai.OpenAI()
    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    "Generate a dynamic A2UI dashboard based on the conversation."
                ),
            },
        ],
        tools=[
            {
                "type": "function",
                "function": RENDER_A2UI_TOOL_SCHEMA,
            }
        ],
        tool_choice={
            "type": "function",
            "function": {"name": "render_a2ui"},
        },
    )

    choice = response.choices[0]
    if choice.message.tool_calls:
        args = json.loads(choice.message.tool_calls[0].function.arguments)
        result = build_a2ui_operations_from_tool_call(args)
        return json.dumps(result)

    return json.dumps({"error": "LLM did not call render_a2ui"})


agent = Agent(
    model=OpenAIChat(id="gpt-4o", timeout=120),
    tools=[generate_a2ui],
    tool_call_limit=4,
    description=SYSTEM_PROMPT,
)
