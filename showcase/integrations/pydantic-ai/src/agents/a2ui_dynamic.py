"""PydanticAI agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.

Mirrors showcase/integrations/langgraph-python/src/agents/a2ui_dynamic.py.

Pattern:
- The agent binds an explicit `generate_a2ui` tool. When called,
  `generate_a2ui` invokes a secondary LLM bound to a `render_a2ui`
  function-tool schema (tool_choice forced) with the run's App Context.
- The tool returns an `a2ui_operations` container (via the shared
  `build_a2ui_operations_from_tool_call` helper) that the CopilotKit
  runtime's A2UI middleware detects in the tool result and forwards to
  the frontend renderer.
- The runtime endpoint is the standard `copilotkit` route (the A2UI
  middleware detects the container without needing any injected runtime
  tool).

PydanticAI notes:
- `SalesAnalystDeps` carries App Context separately from persistent state.
  The forwarded conversation lives on the PydanticAI
  `RunContext` itself, as `ctx.messages` (the `ModelMessage` history the
  AG-UI adapter built from the frontend run input). We extract the real
  user/assistant turns from `ctx.messages` and feed the secondary gen-ui
  LLM a `[system, *real_messages]` prompt — mirroring the langgraph-python
  north-star (`[SystemMessage(prompt), *real_messages]`).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from textwrap import dedent

from _shared.a2ui_sales import (
    SALES_ANALYST_PROMPT,
    SALES_CATALOG_ID,
    with_app_context,
)
from ag_ui.core import Context
from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelRequest, ModelResponse
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.ui import StateDeps

from tools import build_a2ui_operations_from_tool_call


class EmptyState(BaseModel):
    """The declarative-gen-ui demo has no persistent per-thread state."""

    pass


@dataclass
class SalesAnalystDeps(StateDeps[EmptyState]):
    app_context: tuple[Context, ...] = ()


SYSTEM_PROMPT = SALES_ANALYST_PROMPT + " Call `generate_a2ui` without arguments."


# System prompt for the SECONDARY (gen-ui) LLM call. The primary agent
# decided UI is warranted and called `generate_a2ui`; this prompt instructs
# the secondary LLM to design the A2UI surface from the real conversation
# (appended after this message) via the forced `render_a2ui` tool call.
GEN_UI_SYSTEM_PROMPT = dedent(
    """
    You are a UI designer for Declarative Generative UI (A2UI — Dynamic
    Schema). Given the conversation so far, design a rich, well-structured
    A2UI v0.9 surface that best presents the answer — a dashboard, status
    report, KPI summary, card layout, info grid, pie/donut chart for
    part-of-whole breakdowns, or bar chart for comparisons across
    categories. Ground the dashboard in the App Context data and follow its
    composition rules. Use the registered catalog components, including
    DataTable for sales team performance. Always emit the surface by calling
    the `render_a2ui` tool.
    """
).strip()


def _extract_conversation(ctx: RunContext[SalesAnalystDeps]) -> list[dict]:
    """Extract the real user/assistant turns from the pydantic-ai RunContext.

    The forwarded conversation lives on ``ctx.messages`` (a list of
    ``ModelRequest`` / ``ModelResponse``). ``ModelRequest`` carries the user input as a
    ``UserPromptPart`` (``part_kind == "user-prompt"``) and ``ModelResponse``
    carries the assistant text as ``TextPart`` (``part_kind == "text"``). We
    flatten those into the OpenAI ``{role, content}`` shape the secondary
    gen-ui call expects, skipping system/tool/internal parts so the secondary
    LLM sees only the human-facing conversation.
    """
    conversation: list[dict] = []
    for msg in ctx.messages or []:
        if isinstance(msg, ModelRequest):
            role = "user"
            wanted_kind = "user-prompt"
        elif isinstance(msg, ModelResponse):
            role = "assistant"
            wanted_kind = "text"
        else:  # pragma: no cover - defensive; only Request/Response exist today
            continue

        for part in msg.parts:
            if getattr(part, "part_kind", None) != wanted_kind:
                continue
            content = _part_content_to_text(getattr(part, "content", None))
            if content:
                conversation.append({"role": role, "content": content})
    return conversation


def _part_content_to_text(content: object) -> str:
    """Normalize a part's ``content`` (str or multimodal list) to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif hasattr(part, "text"):
                text = getattr(part, "text", None)
                if isinstance(text, str):
                    parts.append(text)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "".join(parts)
    return ""


agent = Agent(
    model=OpenAIResponsesModel("gpt-6-luna"),
    deps_type=SalesAnalystDeps,
    system_prompt=SYSTEM_PROMPT,
)


@agent.instructions
def sales_context(ctx: RunContext[SalesAnalystDeps]) -> str:
    return with_app_context("", ctx.deps.app_context)


@agent.tool
def generate_a2ui(ctx: RunContext[SalesAnalystDeps]) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema + data. The result is returned
    as an `a2ui_operations` container for the A2UI middleware to detect
    and forward to the frontend renderer.
    """
    from openai import OpenAI

    conversation_messages = _extract_conversation(ctx)

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

    # North-star shape: [system prompt, *real conversation]. The real
    # user/assistant turns from ``ctx.messages`` give the secondary LLM the
    # actual request to design UI for, instead of an empty/system-only prompt.
    llm_messages: list[dict] = [
        {
            "role": "system",
            "content": with_app_context(GEN_UI_SYSTEM_PROMPT, ctx.deps.app_context),
        },
    ]
    llm_messages.extend(conversation_messages)
    if not conversation_messages:
        # Defensive fallback: never send a bare system-only prompt if the
        # conversation somehow could not be extracted.
        llm_messages.append(
            {
                "role": "user",
                "content": "Generate a useful dashboard UI from the conversation so far.",
            }
        )

    response = client.chat.completions.create(
        reasoning_effort="none",
        model="gpt-6-luna",
        messages=llm_messages,
        tools=[tool_schema],
        tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
    )

    if not response.choices[0].message.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.choices[0].message.tool_calls[0]
    try:
        args = json.loads(tool_call.function.arguments)
    except (json.JSONDecodeError, TypeError):
        return json.dumps({"error": "render_a2ui returned malformed arguments"})
    if not isinstance(args, dict):
        return json.dumps({"error": "render_a2ui returned malformed arguments"})
    # Override catalog id to match the frontend's declarative-gen-ui catalog.
    args["catalogId"] = SALES_CATALOG_ID
    # Guard against missing/empty components so the downstream helper never
    # raises out of the tool; surface a structured error instead.
    if not args.get("components"):
        return json.dumps({"error": "render_a2ui returned no components"})
    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)
