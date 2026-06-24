"""PydanticAI agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.

Mirrors showcase/integrations/langgraph-python/src/agents/a2ui_dynamic.py.

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
- `agent.to_ag_ui()` exposes StateDeps to tools via `ctx.deps`, but
  `StateDeps` carries ONLY a `state` field — it has no `copilotkit`
  attribute. The real forwarded conversation lives on the pydantic-ai
  `RunContext` itself, as `ctx.messages` (the `ModelMessage` history the
  AG-UI adapter built from the frontend run input). We extract the real
  user/assistant turns from `ctx.messages` and feed the secondary gen-ui
  LLM a `[system, *real_messages]` prompt — mirroring the langgraph-python
  north-star (`[SystemMessage(prompt), *real_messages]`).
"""

from __future__ import annotations

import json
from textwrap import dedent

from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.messages import ModelRequest, ModelResponse
from pydantic_ai.models.openai import OpenAIResponsesModel

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
    categories. Use the registered catalog components (Card, StatusBadge,
    Metric, InfoRow, PrimaryButton, PieChart, BarChart) plus the basic A2UI
    primitives. Always emit the surface by calling the `render_a2ui` tool.
    """
).strip()


def _extract_conversation(ctx: RunContext[StateDeps[EmptyState]]) -> list[dict]:
    """Extract the real user/assistant turns from the pydantic-ai RunContext.

    The forwarded conversation lives on ``ctx.messages`` (a list of
    ``ModelRequest`` / ``ModelResponse``), NOT on ``ctx.deps`` — ``StateDeps``
    has only a ``state`` field. ``ModelRequest`` carries the user input as a
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

    # The real forwarded conversation lives on ``ctx.messages`` — NOT on
    # ``ctx.deps`` (StateDeps has only ``state``, no ``copilotkit``). Mirror
    # the langgraph-python north-star: build the secondary prompt as
    # ``[system, *real_messages]`` so the gen-ui LLM designs UI from the
    # actual conversation rather than an empty/system-only context.
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
        {"role": "system", "content": GEN_UI_SYSTEM_PROMPT},
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
        model="gpt-4.1",
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
    args.setdefault("catalogId", CUSTOM_CATALOG_ID)
    # Guard against missing/empty components so the downstream helper never
    # raises out of the tool; surface a structured error instead.
    if not args.get("components"):
        return json.dumps({"error": "render_a2ui returned no components"})
    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)
