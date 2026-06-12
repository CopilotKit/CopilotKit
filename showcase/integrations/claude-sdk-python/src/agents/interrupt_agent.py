"""Claude Agent SDK backend for the interrupt-adapted demos.

This agent powers two demos (gen-ui-interrupt, interrupt-headless) that in the
LangGraph showcase rely on the native ``interrupt()`` primitive with
checkpoint/resume. The Claude Agent SDK does NOT have that primitive, so we
adapt by delegating the time-picker interaction to a **frontend tool** that the
agent calls by name (``schedule_meeting``). The frontend registers the tool via
``useFrontendTool`` with an async handler; that handler renders the interactive
picker, waits for the user to choose a slot (or cancel), and resolves the tool
call with the result. The backend only defines the system prompt and advertises
no local ``schedule_meeting`` implementation — the agent's tool call is satisfied
entirely by the frontend.

Mirrors the ms-agent-python ``interrupt_agent.py`` reference (Strategy B).
"""

# @region[backend-interrupt-tool]
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
    ToolCallStartEvent,
)
from ag_ui.encoder import EventEncoder


# @region[backend-tool-call]
SYSTEM_PROMPT = dedent("""
    You are a scheduling assistant. Whenever the user asks you to book a call
    or schedule a meeting, you MUST call the `schedule_meeting` tool. Pass a
    short `topic` describing the purpose of the meeting and, if known, an
    `attendee` describing who the meeting is with.

    The `schedule_meeting` tool is implemented on the client: it surfaces a
    time-picker UI to the user and returns the user's selection. After the
    tool returns, briefly confirm whether the meeting was scheduled and at
    what time, or note that the user cancelled. Do NOT ask for approval
    yourself — always call the tool and let the picker handle the decision.

    Keep responses short and friendly. After you finish executing tools,
    always send a brief final assistant message summarizing what happened so
    the message persists.
""").strip()
# @endregion[backend-tool-call]
# @endregion[backend-interrupt-tool]


async def run_interrupt_agent(input_data: RunAgentInput) -> AsyncIterator[str]:
    """Stream a Claude response that may call the frontend ``schedule_meeting`` tool.

    ``schedule_meeting`` is defined on the frontend via ``useFrontendTool``.
    AG-UI forwards frontend tool definitions in ``input_data.tools``, so we
    just pass them straight to Claude and let the standard tool-call lifecycle
    resolve the user's choice back through CopilotKit.
    """
    encoder = EventEncoder()
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    # Convert AG-UI messages to Anthropic format.
    messages: list[dict[str, Any]] = []
    for msg in input_data.messages or []:
        role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)

        # Handle tool result messages from AG-UI (resolved frontend tools).
        if role == "tool":
            tool_call_id = getattr(msg, "tool_call_id", None) or (
                getattr(msg, "toolCallId", None)
            )
            raw = getattr(msg, "content", None)
            result_text = ""
            if isinstance(raw, str):
                result_text = raw
            elif isinstance(raw, list):
                parts = []
                for part in raw:
                    if hasattr(part, "text"):
                        parts.append(part.text)
                    elif isinstance(part, dict) and "text" in part:
                        parts.append(part["text"])
                parts_text = "".join(parts)
                if parts_text:
                    result_text = parts_text
                else:
                    result_text = json.dumps(raw)
            if tool_call_id:
                messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": tool_call_id,
                                "content": result_text,
                            }
                        ],
                    }
                )
            continue

        if role not in ("user", "assistant"):
            continue

        raw = getattr(msg, "content", None)

        # For assistant messages, check for tool calls.
        if role == "assistant":
            msg_tool_calls = getattr(msg, "tool_calls", None)
            text_content = ""
            if isinstance(raw, str):
                text_content = raw
            elif isinstance(raw, list):
                for part in raw:
                    if hasattr(part, "text"):
                        text_content += part.text
                    elif isinstance(part, dict) and "text" in part:
                        text_content += part["text"]

            if msg_tool_calls:
                content_blocks: list[dict[str, Any]] = []
                if text_content:
                    content_blocks.append({"type": "text", "text": text_content})
                for tc in msg_tool_calls:
                    tc_id = getattr(tc, "id", None) or (
                        tc.get("id") if isinstance(tc, dict) else None
                    )
                    func = getattr(tc, "function", None) or (
                        tc.get("function") if isinstance(tc, dict) else None
                    )
                    if func:
                        tc_name = getattr(func, "name", None) or (
                            func.get("name") if isinstance(func, dict) else "unknown"
                        )
                        tc_args_str = getattr(func, "arguments", None) or (
                            func.get("arguments", "{}")
                            if isinstance(func, dict)
                            else "{}"
                        )
                    else:
                        tc_name = "unknown"
                        tc_args_str = "{}"
                    try:
                        tc_args = (
                            json.loads(tc_args_str)
                            if isinstance(tc_args_str, str)
                            else tc_args_str
                        )
                    except json.JSONDecodeError:
                        tc_args = {}
                    content_blocks.append(
                        {
                            "type": "tool_use",
                            "id": tc_id or "unknown",
                            "name": tc_name,
                            "input": tc_args,
                        }
                    )
                messages.append({"role": "assistant", "content": content_blocks})
                continue
            elif text_content:
                messages.append({"role": "assistant", "content": text_content})
                continue

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

    # Forward frontend-defined tools (including useFrontendTool's `schedule_meeting`)
    # to Claude. AG-UI sends them in `input_data.tools` with JSON-Schema
    # parameters; Claude expects `input_schema` of the same shape.
    tools: list[dict[str, Any]] = []
    for t in input_data.tools or []:
        name = getattr(t, "name", None) or (
            t.get("name") if isinstance(t, dict) else None
        )
        description = getattr(t, "description", None) or (
            t.get("description", "") if isinstance(t, dict) else ""
        )
        parameters = getattr(t, "parameters", None) or (
            t.get("parameters", {}) if isinstance(t, dict) else {}
        )
        if not name:
            continue
        tools.append(
            {
                "name": name,
                "description": description or "",
                "input_schema": parameters or {"type": "object", "properties": {}},
            }
        )

    thread_id = input_data.thread_id or "default"
    run_id = input_data.run_id or "run-1"

    yield encoder.encode(
        RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id)
    )

    msg_id = f"msg-{run_id}-0"
    yield encoder.encode(
        TextMessageStartEvent(
            type=EventType.TEXT_MESSAGE_START,
            message_id=msg_id,
            role="assistant",
        )
    )

    stream_kwargs: dict[str, Any] = {
        "model": os.getenv("ANTHROPIC_MODEL", "claude-opus-4-5"),
        "max_tokens": 1024,
        "system": SYSTEM_PROMPT,
        "messages": messages,
    }
    if tools:
        stream_kwargs["tools"] = tools

    try:
        async with client.messages.stream(**stream_kwargs) as stream:
            current_tool_id: str | None = None
            current_tool_name: str | None = None

            async for event in stream:
                etype = type(event).__name__

                if etype == "RawContentBlockStartEvent":
                    block = event.content_block  # type: ignore[attr-defined]
                    if block.type == "tool_use":
                        current_tool_id = block.id
                        current_tool_name = block.name
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
                        yield encoder.encode(
                            TextMessageContentEvent(
                                type=EventType.TEXT_MESSAGE_CONTENT,
                                message_id=msg_id,
                                delta=delta.text,
                            )
                        )
                    elif delta.type == "input_json_delta":
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
                    if current_tool_id:
                        yield encoder.encode(
                            ToolCallEndEvent(
                                type=EventType.TOOL_CALL_END,
                                tool_call_id=current_tool_id,
                            )
                        )
                        current_tool_id = None
                        current_tool_name = None
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

    yield encoder.encode(
        RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )
    )
