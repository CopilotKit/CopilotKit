"""Claude Agent SDK backend for the Declarative Generative UI (A2UI Dynamic) demo.

The agent exposes a single `generate_a2ui(context: str)` tool. When called,
it invokes a secondary Claude call bound to the `render_a2ui` tool schema
(forced via `tool_choice`) and returns an `a2ui_operations` container which
the runtime's A2UI middleware detects and forwards to the frontend renderer.

The dedicated runtime route (`api/copilotkit-declarative-gen-ui/route.ts`)
sets `injectA2UITool: false` so the runtime does not double-bind a second
A2UI tool on top of this one — the registered client catalog is still
serialised into `copilotkit.context` so the secondary LLM knows what's
available.

Mirrors the langgraph-python and ag2 references.
"""

from __future__ import annotations

import json
import os
import traceback
from collections.abc import AsyncIterator
from textwrap import dedent
from typing import Any

import anthropic
from ag_ui.core import (
    EventType,
    RunAgentInput,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from ag_ui.encoder import EventEncoder

from tools import (
    RENDER_A2UI_TOOL_SCHEMA,
    build_a2ui_operations_from_tool_call,
)


SYSTEM_PROMPT = dedent("""
    You are a demo assistant for Declarative Generative UI (A2UI — Dynamic
    Schema). Whenever a response would benefit from a rich visual — a
    dashboard, status report, KPI summary, card layout, info grid, a
    pie/donut chart of part-of-whole breakdowns, a bar chart comparing
    values across categories, or anything more structured than plain text —
    call `generate_a2ui` to draw it. The registered catalog includes
    `Card`, `StatusBadge`, `Metric`, `InfoRow`, `PrimaryButton`, `PieChart`,
    and `BarChart` (in addition to the basic A2UI primitives). Prefer
    `PieChart` for part-of-whole breakdowns and `BarChart` for comparisons
    across categories. `generate_a2ui` takes a single `context` argument
    summarising the conversation. Keep chat replies to one short sentence;
    let the UI do the talking.
""").strip()


# @region[a2ui-backend-tool]
GENERATE_A2UI_TOOL = {
    "name": "generate_a2ui",
    "description": (
        "Generate dynamic A2UI components based on the conversation. "
        "A secondary LLM designs the UI schema and data using the registered catalog."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "context": {
                "type": "string",
                "description": "Conversation context summary the secondary LLM should design UI from.",
            },
        },
        "required": ["context"],
    },
}


def _generate_a2ui(
    context: str, conversation_messages: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    """Invoke a secondary LLM bound to render_a2ui and return an operations container."""
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    render_tool_schema = {
        "name": RENDER_A2UI_TOOL_SCHEMA["name"],
        "description": RENDER_A2UI_TOOL_SCHEMA["description"],
        "input_schema": RENDER_A2UI_TOOL_SCHEMA["parameters"],
    }
    llm_messages = conversation_messages or [
        {
            "role": "user",
            "content": "Generate a dynamic A2UI dashboard based on the conversation.",
        }
    ]
    response = client.messages.create(
        model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4.6"),
        max_tokens=4096,
        system=context or "Generate a useful dashboard UI.",
        messages=llm_messages,
        tools=[render_tool_schema],
        tool_choice={"type": "tool", "name": "render_a2ui"},
    )
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "render_a2ui":
            return build_a2ui_operations_from_tool_call(dict(block.input))
    return {"error": "LLM did not call render_a2ui"}


# @endregion[a2ui-backend-tool]


async def run_a2ui_dynamic_agent(input_data: RunAgentInput) -> AsyncIterator[str]:
    """Stream a Claude conversation that may call `generate_a2ui`."""
    encoder = EventEncoder()
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    messages: list[dict[str, Any]] = []
    for msg in input_data.messages or []:
        role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
        if role not in ("user", "assistant"):
            continue
        raw = getattr(msg, "content", None)
        content = ""
        if isinstance(raw, str):
            content = raw
        elif isinstance(raw, list):
            parts = []
            for part in raw:
                if hasattr(part, "text"):
                    parts.append(part.text)
                elif isinstance(part, dict) and "text" in part:
                    parts.append(part["text"])
            content = "".join(parts)
        if content:
            messages.append({"role": role, "content": content})

    thread_id = input_data.thread_id or "default"
    run_id = input_data.run_id or "run-1"

    yield encoder.encode(
        RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id)
    )

    while True:
        msg_id = f"msg-{run_id}-{len(messages)}"
        yield encoder.encode(
            TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=msg_id,
                role="assistant",
            )
        )

        response_text = ""
        tool_calls: list[dict[str, Any]] = []
        try:
            async with client.messages.stream(
                model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4.6"),
                max_tokens=2048,
                system=SYSTEM_PROMPT,
                messages=messages,
                tools=[GENERATE_A2UI_TOOL],
            ) as stream:
                current_tool_id: str | None = None
                current_tool_name: str | None = None
                current_tool_args = ""

                async for event in stream:
                    etype = type(event).__name__
                    if etype == "RawContentBlockStartEvent":
                        block = event.content_block  # type: ignore[attr-defined]
                        if block.type == "tool_use":
                            current_tool_id = block.id
                            current_tool_name = block.name
                            current_tool_args = ""
                            yield encoder.encode(
                                ToolCallStartEvent(
                                    type=EventType.TOOL_CALL_START,
                                    tool_call_id=current_tool_id,
                                    tool_call_name=current_tool_name,
                                    parent_message_id=msg_id,
                                )
                            )
                    elif etype == "RawContentBlockDeltaEvent":
                        delta = event.delta  # type: ignore[attr-defined]
                        if delta.type == "text_delta":
                            response_text += delta.text
                            yield encoder.encode(
                                TextMessageContentEvent(
                                    type=EventType.TEXT_MESSAGE_CONTENT,
                                    message_id=msg_id,
                                    delta=delta.text,
                                )
                            )
                        elif delta.type == "input_json_delta":
                            current_tool_args += delta.partial_json
                            yield encoder.encode(
                                ToolCallArgsEvent(
                                    type=EventType.TOOL_CALL_ARGS,
                                    tool_call_id=current_tool_id or "",
                                    delta=delta.partial_json,
                                )
                            )
                    elif etype in (
                        "RawContentBlockStopEvent",
                        "ParsedContentBlockStopEvent",
                    ):
                        if current_tool_id and current_tool_name:
                            yield encoder.encode(
                                ToolCallEndEvent(
                                    type=EventType.TOOL_CALL_END,
                                    tool_call_id=current_tool_id,
                                )
                            )
                            try:
                                parsed = (
                                    json.loads(current_tool_args)
                                    if current_tool_args
                                    else {}
                                )
                            except json.JSONDecodeError:
                                parsed = {}
                            tool_calls.append(
                                {
                                    "id": current_tool_id,
                                    "name": current_tool_name,
                                    "input": parsed,
                                }
                            )
                            current_tool_id = None
                            current_tool_name = None
                            current_tool_args = ""
        except Exception:
            err_text = f"Agent error: {traceback.format_exc()}"
            yield encoder.encode(
                TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=msg_id,
                    delta=err_text,
                )
            )

        yield encoder.encode(
            TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=msg_id,
            )
        )

        if not tool_calls:
            break

        # Build assistant turn with tool_use blocks.
        assistant_content: list[dict[str, Any]] = []
        if response_text:
            assistant_content.append({"type": "text", "text": response_text})
        for tc in tool_calls:
            assistant_content.append(
                {
                    "type": "tool_use",
                    "id": tc["id"],
                    "name": tc["name"],
                    "input": tc["input"],
                }
            )
        messages.append({"role": "assistant", "content": assistant_content})

        # Execute generate_a2ui and emit tool_result.
        tool_results: list[dict[str, Any]] = []
        for tc in tool_calls:
            if tc["name"] == "generate_a2ui":
                ctx = tc["input"].get("context", "")
                result_obj = _generate_a2ui(ctx, conversation_messages=messages)
                result_text = json.dumps(result_obj)
            else:
                result_text = json.dumps({"error": f"unknown tool {tc['name']}"})
            yield encoder.encode(
                ToolCallResultEvent(
                    type=EventType.TOOL_CALL_RESULT,
                    tool_call_id=tc["id"],
                    message_id=f"{msg_id}-tool-result-{tc['id']}",
                    content=result_text,
                )
            )
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tc["id"],
                    "content": result_text,
                }
            )
        messages.append({"role": "user", "content": tool_results})

    yield encoder.encode(
        RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )
    )
