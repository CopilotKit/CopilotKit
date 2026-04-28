"""
MS Agent Framework agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.

Pattern (ported from the LangGraph reference
`showcase/packages/langgraph-python/src/agents/a2ui_dynamic.py`):

- The agent binds an explicit `generate_a2ui` tool. When called, it invokes a
  secondary LLM bound to `render_a2ui` (tool_choice forced) and returns the
  resulting `a2ui_operations` container.
- The runtime (see `src/app/api/copilotkit-declarative-gen-ui/route.ts`) uses
  `injectA2UITool: false` because the tool binding is owned by the agent here
  (double-injection would duplicate the tool slot).
"""

from __future__ import annotations

import json
import os
import sys
from textwrap import dedent
from typing import Annotated

from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"),
)
from tools import build_a2ui_operations_from_tool_call  # noqa: E402

CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog"


@tool(
    name="generate_a2ui",
    description=(
        "Generate dynamic A2UI components based on the conversation. "
        "A secondary LLM designs the UI schema and data."
    ),
)
def generate_a2ui(
    context: Annotated[
        str,
        Field(description="Conversation context to generate UI from."),
    ],
) -> str:
    """Generate dynamic A2UI dashboard from conversation context."""
    from openai import OpenAI

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

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {
                "role": "system",
                "content": (
                    context
                    or f"Generate a useful dashboard UI. Use catalogId='{CUSTOM_CATALOG_ID}'."
                ),
            },
            {
                "role": "user",
                "content": "Generate a dynamic A2UI dashboard based on the conversation.",
            },
        ],
        tools=[tool_schema],
        tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
    )

    if not response.choices[0].message.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.choices[0].message.tool_calls[0]
    args = json.loads(tool_call.function.arguments)
    # Default the catalog to the dynamic-gen-ui catalog if the LLM omitted it.
    args.setdefault("catalogId", CUSTOM_CATALOG_ID)
    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)


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
    `generate_a2ui` takes a `context` string summarising the user's request
    and handles the rendering automatically. Keep chat replies to one short
    sentence; let the UI do the talking.
    """
).strip()


def create_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the MS-Agent-backed declarative-gen-ui agent."""
    base_agent = Agent(
        client=chat_client,
        name="declarative_gen_ui_agent",
        instructions=SYSTEM_PROMPT,
        tools=[generate_a2ui],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Dynamic A2UI generator that designs rich UI surfaces on demand.",
        require_confirmation=False,
    )
