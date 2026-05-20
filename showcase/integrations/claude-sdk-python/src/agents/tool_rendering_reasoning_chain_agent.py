"""Tool Rendering (Reasoning Chain).

Combines:
  - Visible reasoning steps (parsed out of `<reasoning>...</reasoning>`
    blocks the model emits before each tool call).
  - Sequential tool calls: get_weather, search_flights, get_stock_price,
    roll_dice.
"""

from __future__ import annotations

import json
import os
import random
import traceback
from collections.abc import AsyncIterator
from textwrap import dedent
from typing import Any

import anthropic
from ag_ui.core import (
    EventType,
    ReasoningMessageContentEvent,
    ReasoningMessageEndEvent,
    ReasoningMessageStartEvent,
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

TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_weather",
        "description": "Get the current weather for a given location.",
        "input_schema": {
            "type": "object",
            "properties": {"location": {"type": "string"}},
            "required": ["location"],
        },
    },
    {
        "name": "search_flights",
        "description": "Search mock flights between two airports.",
        "input_schema": {
            "type": "object",
            "properties": {
                "origin": {"type": "string"},
                "destination": {"type": "string"},
            },
            "required": ["origin", "destination"],
        },
    },
    {
        "name": "get_stock_price",
        "description": "Get a mock current price for a stock ticker.",
        "input_schema": {
            "type": "object",
            "properties": {"ticker": {"type": "string"}},
            "required": ["ticker"],
        },
    },
    {
        "name": "roll_dice",
        "description": "Roll a single die with the given number of sides.",
        "input_schema": {
            "type": "object",
            "properties": {"sides": {"type": "integer"}},
            "required": [],
        },
    },
]

SYSTEM_PROMPT = dedent("""
    You are a travel & lifestyle concierge. When a user asks a question,
    BEFORE calling any tool, emit a short step-by-step plan inside
    `<reasoning>...</reasoning>` tags (one or two short sentences per
    step, plain text only). Then call 2+ tools in succession when
    relevant. After the last tool, write a brief final summary.
""").strip()


def _execute_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    if name == "get_weather":
        return {
            "city": args.get("location", ""),
            "temperature": 68,
            "humidity": 55,
            "wind_speed": 10,
            "conditions": "Sunny",
        }
    if name == "search_flights":
        return {
            "origin": args.get("origin", ""),
            "destination": args.get("destination", ""),
            "flights": [
                {
                    "airline": "United",
                    "flight": "UA231",
                    "depart": "08:15",
                    "arrive": "16:45",
                    "price_usd": 348,
                },
                {
                    "airline": "Delta",
                    "flight": "DL412",
                    "depart": "11:20",
                    "arrive": "19:55",
                    "price_usd": 312,
                },
                {
                    "airline": "JetBlue",
                    "flight": "B6722",
                    "depart": "17:05",
                    "arrive": "01:30",
                    "price_usd": 289,
                },
            ],
        }
    if name == "get_stock_price":
        return {
            "ticker": str(args.get("ticker", "")).upper(),
            "price_usd": round(
                100 + random.randint(0, 400) + random.randint(0, 99) / 100, 2
            ),
            "change_pct": round(
                random.choice([-1, 1]) * (random.randint(0, 300) / 100), 2
            ),
        }
    if name == "roll_dice":
        sides = int(args.get("sides", 6) or 6)
        return {"sides": sides, "result": random.randint(1, max(2, sides))}
    return {"error": f"unknown tool {name}"}


async def run_tool_rendering_reasoning_chain_agent(
    input_data: RunAgentInput,
) -> AsyncIterator[str]:
    encoder = EventEncoder()
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    messages: list[dict[str, Any]] = []
    for msg in input_data.messages or []:
        role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
        if role not in ("user", "assistant"):
            continue
        raw_content = getattr(msg, "content", None)
        content = ""
        if isinstance(raw_content, str):
            content = raw_content
        elif isinstance(raw_content, list):
            parts: list[str] = []
            for part in raw_content:
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

    REASONING_OPEN = "<reasoning>"
    REASONING_CLOSE = "</reasoning>"

    iteration = 0
    while True:
        iteration += 1
        msg_id = f"msg-{run_id}-{iteration}"
        reasoning_msg_id = f"reason-{run_id}-{iteration}"

        in_reasoning = False
        reasoning_started = False
        text_started = False
        buffer = ""
        response_text = ""
        tool_calls: list[dict[str, Any]] = []

        async def flush_reasoning(chunk: str):
            nonlocal reasoning_started
            if not chunk:
                return
            if not reasoning_started:
                reasoning_started = True
                yield encoder.encode(
                    ReasoningMessageStartEvent(
                        type=EventType.REASONING_MESSAGE_START,
                        message_id=reasoning_msg_id,
                        role="reasoning",
                    )
                )
            yield encoder.encode(
                ReasoningMessageContentEvent(
                    type=EventType.REASONING_MESSAGE_CONTENT,
                    message_id=reasoning_msg_id,
                    delta=chunk,
                )
            )

        try:
            async with client.messages.stream(
                model=os.getenv("ANTHROPIC_MODEL", "claude-opus-4-5"),
                max_tokens=2048,
                system=SYSTEM_PROMPT,
                messages=messages,
                tools=TOOLS,
            ) as stream:
                current_tool_id: str | None = None
                current_tool_name: str | None = None
                current_tool_args = ""

                async for event in stream:
                    etype = type(event).__name__
                    if etype == "RawContentBlockStartEvent":
                        block = event.content_block  # type: ignore[attr-defined]
                        if block.type == "tool_use":
                            # Flush any pending text/reasoning buffer first.
                            if buffer:
                                if in_reasoning:
                                    async for ev in flush_reasoning(buffer):
                                        yield ev
                                else:
                                    if not text_started:
                                        text_started = True
                                        yield encoder.encode(
                                            TextMessageStartEvent(
                                                type=EventType.TEXT_MESSAGE_START,
                                                message_id=msg_id,
                                                role="assistant",
                                            )
                                        )
                                    yield encoder.encode(
                                        TextMessageContentEvent(
                                            type=EventType.TEXT_MESSAGE_CONTENT,
                                            message_id=msg_id,
                                            delta=buffer,
                                        )
                                    )
                                    response_text += buffer
                                buffer = ""
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
                            buffer += delta.text
                            # Drain
                            while True:
                                if in_reasoning:
                                    close_idx = buffer.find(REASONING_CLOSE)
                                    if close_idx == -1:
                                        keep = max(
                                            0, len(buffer) - len(REASONING_CLOSE)
                                        )
                                        chunk = buffer[:keep]
                                        buffer = buffer[keep:]
                                        async for ev in flush_reasoning(chunk):
                                            yield ev
                                        break
                                    chunk = buffer[:close_idx]
                                    async for ev in flush_reasoning(chunk):
                                        yield ev
                                    if reasoning_started:
                                        yield encoder.encode(
                                            ReasoningMessageEndEvent(
                                                type=EventType.REASONING_MESSAGE_END,
                                                message_id=reasoning_msg_id,
                                            )
                                        )
                                        reasoning_started = False
                                    buffer = buffer[close_idx + len(REASONING_CLOSE) :]
                                    in_reasoning = False
                                    continue
                                else:
                                    open_idx = buffer.find(REASONING_OPEN)
                                    if open_idx == -1:
                                        keep = max(0, len(buffer) - len(REASONING_OPEN))
                                        chunk = buffer[:keep]
                                        buffer = buffer[keep:]
                                        if chunk:
                                            if not text_started:
                                                text_started = True
                                                yield encoder.encode(
                                                    TextMessageStartEvent(
                                                        type=EventType.TEXT_MESSAGE_START,
                                                        message_id=msg_id,
                                                        role="assistant",
                                                    )
                                                )
                                            yield encoder.encode(
                                                TextMessageContentEvent(
                                                    type=EventType.TEXT_MESSAGE_CONTENT,
                                                    message_id=msg_id,
                                                    delta=chunk,
                                                )
                                            )
                                            response_text += chunk
                                        break
                                    chunk = buffer[:open_idx]
                                    if chunk:
                                        if not text_started:
                                            text_started = True
                                            yield encoder.encode(
                                                TextMessageStartEvent(
                                                    type=EventType.TEXT_MESSAGE_START,
                                                    message_id=msg_id,
                                                    role="assistant",
                                                )
                                            )
                                        yield encoder.encode(
                                            TextMessageContentEvent(
                                                type=EventType.TEXT_MESSAGE_CONTENT,
                                                message_id=msg_id,
                                                delta=chunk,
                                            )
                                        )
                                        response_text += chunk
                                    # New reasoning message id per block.
                                    reasoning_msg_id = (
                                        f"reason-{run_id}-{iteration}-{len(buffer)}"
                                    )
                                    buffer = buffer[open_idx + len(REASONING_OPEN) :]
                                    in_reasoning = True
                                    continue
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
                                parsed_args = (
                                    json.loads(current_tool_args)
                                    if current_tool_args
                                    else {}
                                )
                            except json.JSONDecodeError:
                                parsed_args = {}
                            tool_calls.append(
                                {
                                    "id": current_tool_id,
                                    "name": current_tool_name,
                                    "input": parsed_args,
                                }
                            )
                            current_tool_id = None
                            current_tool_name = None
                            current_tool_args = ""
        except Exception:
            err_text = f"Agent error: {traceback.format_exc()}"
            if not text_started:
                text_started = True
                yield encoder.encode(
                    TextMessageStartEvent(
                        type=EventType.TEXT_MESSAGE_START,
                        message_id=msg_id,
                        role="assistant",
                    )
                )
            yield encoder.encode(
                TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=msg_id,
                    delta=err_text,
                )
            )

        # Flush remaining buffer.
        if buffer:
            if in_reasoning:
                async for ev in flush_reasoning(buffer):
                    yield ev
                if reasoning_started:
                    yield encoder.encode(
                        ReasoningMessageEndEvent(
                            type=EventType.REASONING_MESSAGE_END,
                            message_id=reasoning_msg_id,
                        )
                    )
                    reasoning_started = False
            else:
                if not text_started:
                    text_started = True
                    yield encoder.encode(
                        TextMessageStartEvent(
                            type=EventType.TEXT_MESSAGE_START,
                            message_id=msg_id,
                            role="assistant",
                        )
                    )
                yield encoder.encode(
                    TextMessageContentEvent(
                        type=EventType.TEXT_MESSAGE_CONTENT,
                        message_id=msg_id,
                        delta=buffer,
                    )
                )
                response_text += buffer
            buffer = ""

        if reasoning_started:
            yield encoder.encode(
                ReasoningMessageEndEvent(
                    type=EventType.REASONING_MESSAGE_END,
                    message_id=reasoning_msg_id,
                )
            )
            reasoning_started = False

        if text_started:
            yield encoder.encode(
                TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END,
                    message_id=msg_id,
                )
            )

        if not tool_calls:
            break

        # Append assistant + tool_use blocks to history.
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

        tool_results: list[dict[str, Any]] = []
        for tc in tool_calls:
            result = _execute_tool(tc["name"], tc["input"])
            yield encoder.encode(
                ToolCallResultEvent(
                    type=EventType.TOOL_CALL_RESULT,
                    tool_call_id=tc["id"],
                    message_id=f"{msg_id}-tr-{tc['id']}",
                    content=json.dumps(result),
                )
            )
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tc["id"],
                    "content": json.dumps(result),
                }
            )
        messages.append({"role": "user", "content": tool_results})

    yield encoder.encode(
        RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )
    )
