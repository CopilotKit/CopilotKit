"""Agno agent for the Declarative Generative UI (A2UI Dynamic Schema) demo.

Mirrors the langgraph-python `a2ui_dynamic.py` pattern: the agent owns the
`generate_a2ui` tool explicitly. When called, it invokes a secondary
OpenAI client bound to `render_a2ui` (tool_choice forced) using the
registered client catalog injected via the runtime's
`state.copilotkit.context`. The tool result returns an `a2ui_operations`
container which the runtime's A2UI middleware detects and forwards to the
frontend renderer.

The running unified frontend bakes manifests at image build, so this
session still has `injectA2UITool: false`. Keep the two-stage body. After
a later frontend-nextjs rebuild with inject true, the middleware
intercepts and this body does not run.
"""

from __future__ import annotations

import json

import openai
from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.run import RunContext
from dotenv import load_dotenv

from agents._header_forwarding import get_forwarded_headers

from tools import (
    build_a2ui_operations_from_tool_call,
    RENDER_A2UI_TOOL_SCHEMA,
)

load_dotenv()


SYSTEM_PROMPT = (
    "You are a sales analyst for Vantage Threads, a fictional B2B apparel "
    "company. Answer every business question by calling `generate_a2ui` to "
    "draw a rich visual surface — a sales dashboard, a rep-performance table, "
    "an at-risk-accounts summary, or an account detail view — rather than "
    "replying in plain prose. The registered catalog includes `Card`, "
    "`StatusBadge`, `Metric`, `InfoRow`, `DataTable`, `PrimaryButton`, "
    "`PieChart`, and `BarChart` (in addition to the basic A2UI primitives "
    "`Row`, `Column`, and `Text`). Pick the component that matches the shape "
    "of the answer: `Metric` tiles for KPIs, `DataTable` for per-rep or "
    "per-deal rankings, `InfoRow` for a stack of account facts, `StatusBadge` "
    "for risk severity, `PieChart` for part-of-whole breakdowns (revenue by "
    "region, revenue by product line), and `BarChart` for comparisons across "
    "categories or time (monthly revenue, quota attainment by rep). Never ask "
    "the user which chart they want. `generate_a2ui` takes a single `context` "
    "argument summarising what to draw. Keep chat replies to one short "
    "sentence; let the UI do the talking."
)


def generate_a2ui(run_context: RunContext, context: str = "") -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an `a2ui_operations` container for the A2UI middleware
    to detect and forward to the frontend renderer.
    """
    if not (context and str(context).strip()):
        msgs = getattr(run_context, "messages", None) or []
        for msg in reversed(msgs):
            role = getattr(msg, "role", None)
            content = getattr(msg, "content", None)
            if role == "user" and content:
                context = content if isinstance(content, str) else str(content)
                break
        if not context:
            context = "sales dashboard for this quarter"
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

    forwarded_headers = get_forwarded_headers()
    client = openai.OpenAI(default_headers=forwarded_headers or None)
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
