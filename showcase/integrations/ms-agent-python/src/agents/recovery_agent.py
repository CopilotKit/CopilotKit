"""
MS Agent Framework agent for the A2UI Error Recovery demo (OSS-158 / OSS-375).

Same dynamic-schema A2UI setup as `a2ui_dynamic.py` (declarative-gen-ui), but
with the recovery-oriented Vantage Threads system prompt from the LangGraph
reference (`langgraph-python/src/agents/recovery_agent.py`).

Backend-owned wiring: this agent OWNS `generate_a2ui` (mirrors a2ui_dynamic).
The dedicated route at `/api/copilotkit-a2ui-recovery` sets
`injectA2UITool: false` so the runtime does not inject a second copy.

MAF limitation (vs LangGraph `get_a2ui_tools`):
  The LangGraph / ADK / Strands recovery cells run a toolkit validate→retry
  loop inside `generate_a2ui` (inner `render_a2ui` sub-agent, maxAttempts=3,
  `a2ui_recovery_exhausted` hard-fail envelope). Microsoft Agent Framework
  has no equivalent toolkit recovery loop. This cell clones the practical
  MAF pattern from `a2ui_dynamic.py` (secondary LLM forced to
  `_design_a2ui_surface` + `build_a2ui_operations_from_tool_call`) with the
  recovery demo system prompt. Full validate→retry visibility depends on
  aimock fixtures driving invalid/valid `_design_a2ui_surface` sequences
  (see `showcase/aimock/d6/ms-agent-python/a2ui-recovery.json`).

Catalog id: `declarative-gen-ui-catalog` (shared with declarative-gen-ui).
Mounted at `/a2ui_recovery` by `agent_server.py`.
"""

from __future__ import annotations

import json
from textwrap import dedent
from typing import Annotated, Any

from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field

from tools import build_a2ui_operations_from_tool_call

CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog"


@tool(
    name="generate_a2ui",
    description=(
        "Generate dynamic A2UI components based on the conversation. "
        "A secondary LLM designs the UI schema and data. Handles rendering "
        "and automatic recovery internally where the platform supports it."
    ),
)
def generate_a2ui(
    context: Annotated[
        str,
        # Default to empty so the primary LLM can call generate_a2ui() with
        # no args (aimock fixtures return `arguments: "{}"`); pydantic rejects
        # missing-context calls with "Argument parsing failed" before the
        # function body runs. Same pattern as a2ui_dynamic / beautiful_chat.
        Field(default="", description="Conversation context to generate UI from."),
    ] = "",
    session: Any = None,
) -> str:
    """Generate dynamic A2UI surface from conversation context."""
    from openai import OpenAI

    # Pull the latest user message from the active agent session so the
    # secondary LLM call sees what the user actually asked for. Without this,
    # aimock's substring matcher can't distinguish HEAL vs EXHAUST pills.
    # `session` is the AgentSession injected by agent_framework. When
    # unavailable, fall back to the caller-supplied `context` string.
    latest_user_message = ""
    if session is not None:
        try:
            messages = list(getattr(session, "input_messages", []) or [])
            for msg in reversed(messages):
                if getattr(msg, "role", None) == "user":
                    text = getattr(msg, "text", None) or str(
                        getattr(msg, "content", "") or ""
                    )
                    if text:
                        latest_user_message = text
                        break
        except Exception:
            latest_user_message = ""

    client = OpenAI()
    tool_schema = {
        "type": "function",
        "function": {
            "name": "_design_a2ui_surface",
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

    # Priority: session latest user message → context arg → recovery keywords
    # catch-all (so direct/test invocations still match SOME fixture).
    user_content = (
        latest_user_message
        or context
        or "Q2 revenue summary, self-correct malformed first attempt, "
        "validation fallback report."
    )
    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {
                "role": "system",
                "content": (
                    f"Generate a useful dashboard UI. Use catalogId='{CUSTOM_CATALOG_ID}'."
                ),
            },
            {"role": "user", "content": user_content},
        ],
        tools=[tool_schema],
        tool_choice={"type": "function", "function": {"name": "_design_a2ui_surface"}},
    )

    if not response.choices[0].message.tool_calls:
        return json.dumps({"error": "LLM did not call _design_a2ui_surface"})

    tool_call = response.choices[0].message.tool_calls[0]
    args = json.loads(tool_call.function.arguments)
    args.setdefault("catalogId", CUSTOM_CATALOG_ID)
    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)


# Keep aligned with the LangGraph recovery_agent SYSTEM_PROMPT: a sales
# analyst that answers every question by drawing a surface. `generate_a2ui`
# handles the rendering — and, where the platform supports it, recovery.
SYSTEM_PROMPT = dedent(
    """
    You are the embedded sales analyst for Vantage Threads, the fictional
    B2B apparel company described in your App Context. Answer every business
    question by calling `generate_a2ui` to draw a rich visual surface, and
    keep the chat reply to one short sentence. Ground every number in the
    sales dataset from your App Context. `generate_a2ui` handles the
    rendering — and its automatic recovery — for you.
    """
).strip()


def create_recovery_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the MS-Agent-backed A2UI recovery agent."""
    base_agent = Agent(
        client=chat_client,
        name="a2ui_recovery_agent",
        instructions=SYSTEM_PROMPT,
        tools=[generate_a2ui],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description=(
            "Dynamic A2UI generator with recovery-oriented sales-analyst "
            "prompt (backend-owned generate_a2ui)."
        ),
        require_confirmation=False,
    )
