"""Agno agent for the Declarative Generative UI (A2UI Dynamic Schema) demo.

LGP shape: the agent binds a no-arg `generate_a2ui` tool. The CopilotKit
runtime (`a2ui.injectA2UITool: true`) owns `render_a2ui`. If this body
still runs, it drives a secondary OpenAI call with tool_choice forced on
`render_a2ui` (not a third planner) and forwards `x-test-id` /
`x-aimock-context` so the slug fixture can match.
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
    "the user which chart they want. `generate_a2ui` takes no arguments "
    "and handles the rendering automatically. Keep chat replies to one short "
    "sentence; let the UI do the talking."
)


def _last_user_text(run_context: RunContext) -> str:
    msgs = getattr(run_context, "messages", None) or []
    for msg in reversed(msgs):
        role = getattr(msg, "role", None)
        content = getattr(msg, "content", None)
        if role == "user" and content:
            return content if isinstance(content, str) else str(content)
    return ""


def generate_a2ui(run_context: RunContext, context: str = "") -> str:
    """Generate a dynamic A2UI dashboard surface from the current conversation.

    Takes no required arguments. Middleware owns `render_a2ui`. If this
    body runs, the inner user message is the last user turn (the pill
    prompt) so the LGP-shaped fixture can key on userMessage + toolName.
    """
    user_text = (context or "").strip() or _last_user_text(run_context)
    if not user_text:
        user_text = "Generate a useful dashboard UI."
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

    forwarded_headers = get_forwarded_headers()
    client = openai.OpenAI(default_headers=forwarded_headers or None)
    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
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
