"""PydanticAI agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.

Mirrors showcase/packages/langgraph-python/src/agents/a2ui_dynamic.py.

Pattern:
- The agent binds an explicit `generate_a2ui` tool. When called,
  `generate_a2ui` invokes a secondary LLM bound to a `render_a2ui`
  function-tool schema (tool_choice forced) using the client catalog
  injected via `copilotkit.context` on the AG-UI payload.
- The tool returns an `a2ui_operations` container (via the shared
  `build_a2ui_operations_from_tool_call` helper) that the CopilotKit
  runtime's A2UI middleware detects in the tool result and forwards to
  the frontend renderer.
- The runtime endpoint is the standard `copilotkit` route (the A2UI
  middleware detects the container without needing any injected runtime
  tool).

PydanticAI notes:
- `agent.to_ag_ui()` exposes StateDeps to tools via `ctx.deps`. The
  AG-UI adapter populates a `copilotkit` attribute on StateDeps with the
  forwarded context/messages from the frontend, which we use to feed the
  secondary LLM's system prompt.
"""

from __future__ import annotations

import json
import os
import sys
from textwrap import dedent

from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"),
)
from tools import build_a2ui_operations_from_tool_call


CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog"


class EmptyState(BaseModel):
    """The declarative-gen-ui demo has no persistent per-thread state."""

    pass


SYSTEM_PROMPT = dedent(
    """
    You are a demo assistant for Declarative Generative UI (A2UI — Dynamic
    Schema). Whenever a response would benefit from a rich visual — a
    dashboard, status report, KPI summary, card layout, info grid, a
    pie/donut chart of part-of-whole breakdowns, a bar chart comparing
    values across categories, or anything more structured than plain text —
    call `generate_a2ui` to draw it. The registered catalog includes
    `Card`, `StatusBadge`, `Metric`, `InfoRow`, `PrimaryButton`, `PieChart`,
    and `BarChart` (in addition to the basic A2UI primitives). Prefer
    `PieChart` for part-of-whole breakdowns (sales by region, traffic
    sources, portfolio allocation) and `BarChart` for comparisons across
    categories (quarterly revenue, headcount by team, signups per month).
    `generate_a2ui` takes no arguments and handles the rendering
    automatically. Keep chat replies to one short sentence; let the UI do
    the talking.
    """
).strip()


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1"),
    deps_type=StateDeps[EmptyState],
    system_prompt=SYSTEM_PROMPT,
)


@agent.tool
def generate_a2ui(ctx: RunContext[StateDeps[EmptyState]]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema + data. The result is returned
    as an `a2ui_operations` container for the A2UI middleware to detect
    and forward to the frontend renderer.
    """
    from openai import OpenAI

    # Extract conversation context + catalog schema from the AG-UI payload.
    copilotkit_state = getattr(ctx.deps, "copilotkit", None)
    conversation_messages: list[dict] = []
    context_entries: list[dict] = []
    if copilotkit_state:
        if hasattr(copilotkit_state, "messages"):
            for msg in (copilotkit_state.messages or []):
                role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
                if role in ("user", "assistant"):
                    content = ""
                    if hasattr(msg, "content"):
                        if isinstance(msg.content, str):
                            content = msg.content
                        elif isinstance(msg.content, list):
                            parts = []
                            for part in msg.content:
                                if hasattr(part, "text"):
                                    parts.append(part.text)
                                elif isinstance(part, dict) and "text" in part:
                                    parts.append(part["text"])
                            content = "".join(parts)
                    if content:
                        conversation_messages.append({"role": role, "content": content})
        if hasattr(copilotkit_state, "context"):
            context_entries = copilotkit_state.context or []

    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )

    client = OpenAI()
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

    llm_messages: list[dict] = [
        {
            "role": "system",
            "content": context_text
            or "Generate a useful dashboard UI from the conversation so far.",
        },
    ]
    llm_messages.extend(conversation_messages)

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=llm_messages,
        tools=[tool_schema],
        tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
    )

    if not response.choices[0].message.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.choices[0].message.tool_calls[0]
    args = json.loads(tool_call.function.arguments)
    # Override catalog id to match the frontend's declarative-gen-ui catalog.
    args.setdefault("catalogId", CUSTOM_CATALOG_ID)
    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)
