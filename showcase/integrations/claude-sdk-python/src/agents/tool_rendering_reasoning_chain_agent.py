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
from typing import Any, Literal, TypedDict, Union, cast

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


# Typed shapes for the assistant-history thinking blocks replayed to Anthropic
# on tool-loop continuation. Type-only — does NOT change how blocks are built.
class ThinkingBlock(TypedDict):
    type: Literal["thinking"]
    thinking: str
    signature: str


class RedactedThinkingBlock(TypedDict):
    type: Literal["redacted_thinking"]
    data: str


ThinkingContentBlock = Union[ThinkingBlock, RedactedThinkingBlock]


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


# Extended-thinking budget for the native reasoning channel. Anthropic
# requires max_tokens > budget_tokens when thinking is enabled.
_THINKING_BUDGET_TOKENS = 2048


def _build_stream_kwargs(messages: list[dict[str, Any]]) -> dict[str, Any]:
    """Build the Anthropic `messages.stream` kwargs with extended thinking
    enabled so Claude streams native `thinking`/`thinking_delta` blocks.

    Mirrors claude-sdk-typescript's /reasoning handler: a thinking-capable
    model plus `thinking={"type": "enabled", ...}`. The model is overridable
    via ANTHROPIC_REASONING_MODEL (falling back to ANTHROPIC_MODEL) so a
    deployment can pin a different extended-thinking model. Under aimock
    replay the thinking channel is produced from the fixture's `reasoning`
    field regardless of the model name.
    """
    model = os.getenv(
        "ANTHROPIC_REASONING_MODEL",
        os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4.6"),
    )
    return {
        "model": model,
        "max_tokens": _THINKING_BUDGET_TOKENS + 2048,
        "system": SYSTEM_PROMPT,
        "messages": messages,
        "tools": TOOLS,
        "thinking": {
            "type": "enabled",
            "budget_tokens": _THINKING_BUDGET_TOKENS,
        },
    }


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
    latest_user_message: dict[str, Any] | None = None
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
            message = {"role": role, "content": content}
            if role == "user":
                latest_user_message = message
            messages.append(message)

    # Each suggestion in this demo is an independent tool-routing task.
    # Keeping prior UI transcript here makes old prompt text eligible for
    # fixture matching and replays prior assistant tool-use turns without their
    # native-thinking blocks. The per-request tool loop below still preserves
    # the assistant/tool history required to complete a single multi-tool turn.
    if latest_user_message is not None:
        messages = [latest_user_message]

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

        # Native extended-thinking streaming state. Hoisted to the iteration
        # scope (not the `async with` body) so the `except`/post-stream cleanup
        # can close an open native thinking block on the error path. Also
        # accumulates the thinking text + signature so the assistant turn can
        # be replayed to Anthropic with its original thinking block(s) first
        # (required when continuing a tool-use conversation with extended
        # thinking enabled).
        native_reasoning_id: str | None = None
        native_reasoning_started = False
        # Per-block accumulators for the thinking block currently streaming.
        thinking_text_acc = ""
        thinking_signature = ""
        # ALL thinking blocks of this assistant turn, in stream order. Anthropic
        # requires that when continuing a tool loop with extended thinking, the
        # assistant turn is replayed with EVERY original thinking block (each
        # with its signature) — not just the last one — as the leading content
        # blocks. `redacted_thinking` blocks are captured here too (as
        # `{"type": "redacted_thinking", "data": ...}`) since they must also be
        # preserved verbatim or Anthropic 400s on continuation.
        thinking_blocks: list[ThinkingContentBlock] = []

        async def flush_reasoning(chunk: str) -> AsyncIterator[str]:
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

        async def emit_text(chunk: str) -> AsyncIterator[str]:
            nonlocal text_started
            if not chunk:
                return
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

        try:
            async with client.messages.stream(
                **_build_stream_kwargs(messages),
            ) as stream:
                current_tool_id: str | None = None
                current_tool_name: str | None = None
                current_tool_args = ""
                # Native extended-thinking streaming. When the model (or
                # aimock replay) emits Anthropic `thinking`/`thinking_delta`
                # blocks, forward them as REASONING_MESSAGE_* — independent of
                # the inline `<reasoning>`-tag text path below, which stays as
                # the no-thinking fallback. Mirrors claude-sdk-typescript's
                # /reasoning handler. (State declared at iteration scope above
                # so error-path cleanup can close an open block.)

                async for event in stream:
                    etype = type(event).__name__
                    if etype == "RawContentBlockStartEvent":
                        block = event.content_block  # type: ignore[attr-defined]
                        if block.type == "thinking":
                            native_reasoning_id = (
                                f"think-{run_id}-{iteration}-{id(block)}"
                            )
                            native_reasoning_started = False
                            # Reset per-block accumulators for the new thinking
                            # block. Seed the signature from the block's initial
                            # `signature` field if Anthropic provides one up
                            # front. The completed block is appended to
                            # `thinking_blocks` on its content_block_stop.
                            thinking_text_acc = ""
                            thinking_signature = getattr(block, "signature", "") or ""
                            continue
                        if block.type == "redacted_thinking":
                            # Redacted thinking has no deltas — its opaque
                            # `data` blob arrives on the block start. Capture it
                            # immediately so the assistant turn can be replayed
                            # with the redacted block preserved verbatim (else
                            # Anthropic 400s on tool-loop continuation). Not
                            # surfaced to the UI.
                            redacted_data = getattr(block, "data", "") or ""
                            if redacted_data:
                                thinking_blocks.append(
                                    {
                                        "type": "redacted_thinking",
                                        "data": redacted_data,
                                    }
                                )
                            continue
                        if block.type == "tool_use":
                            # Flush any pending text/reasoning buffer first.
                            # Text that precedes a tool call is step narration
                            # for the visible chain. Emit it immediately so the
                            # chat surface remains responsive while the tool
                            # loop continues, and keep it in provider history.
                            if buffer:
                                if in_reasoning:
                                    async for ev in flush_reasoning(buffer):
                                        yield ev
                                else:
                                    async for ev in emit_text(buffer):
                                        yield ev
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
                        if delta.type == "thinking_delta" and native_reasoning_id:
                            thinking_text = getattr(delta, "thinking", "") or ""
                            if thinking_text:
                                # Accumulate for history reconstruction.
                                thinking_text_acc += thinking_text
                                if not native_reasoning_started:
                                    native_reasoning_started = True
                                    yield encoder.encode(
                                        ReasoningMessageStartEvent(
                                            type=EventType.REASONING_MESSAGE_START,
                                            message_id=native_reasoning_id,
                                            role="reasoning",
                                        )
                                    )
                                yield encoder.encode(
                                    ReasoningMessageContentEvent(
                                        type=EventType.REASONING_MESSAGE_CONTENT,
                                        message_id=native_reasoning_id,
                                        delta=thinking_text,
                                    )
                                )
                        elif delta.type == "signature_delta" and native_reasoning_id:
                            # Anthropic streams the thinking block's
                            # cryptographic signature as a `signature_delta` on
                            # the thinking content block. Accumulate it so the
                            # replayed assistant turn carries the original
                            # signature (required for tool-loop continuation
                            # with extended thinking). Not surfaced to the UI.
                            thinking_signature += getattr(delta, "signature", "") or ""
                        elif delta.type == "text_delta":
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
                                            async for ev in emit_text(chunk):
                                                yield ev
                                            response_text += chunk
                                        break
                                    chunk = buffer[:open_idx]
                                    if chunk:
                                        async for ev in emit_text(chunk):
                                            yield ev
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
                        if native_reasoning_id is not None:
                            if native_reasoning_started:
                                yield encoder.encode(
                                    ReasoningMessageEndEvent(
                                        type=EventType.REASONING_MESSAGE_END,
                                        message_id=native_reasoning_id,
                                    )
                                )
                            # Finalize THIS thinking block into the per-turn
                            # list (in stream order) so the assistant turn is
                            # replayed with every thinking block, each carrying
                            # its own signature — not just the last one.
                            if thinking_text_acc:
                                thinking_blocks.append(
                                    {
                                        "type": "thinking",
                                        "thinking": thinking_text_acc,
                                        "signature": thinking_signature,
                                    }
                                )
                            thinking_text_acc = ""
                            thinking_signature = ""
                            native_reasoning_id = None
                            native_reasoning_started = False
                        elif current_tool_id and current_tool_name:
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
            # Lifecycle guarantee on the error path: if the stream raised while
            # a native thinking block was still open, close it before emitting
            # the error text bubble so the UI doesn't render a perpetual
            # in-flight thinking bubble. (The post-stream cleanup below closes
            # the `<reasoning>`-tag id; this closes the native one.)
            if native_reasoning_id is not None and native_reasoning_started:
                yield encoder.encode(
                    ReasoningMessageEndEvent(
                        type=EventType.REASONING_MESSAGE_END,
                        message_id=native_reasoning_id,
                    )
                )
                native_reasoning_id = None
                native_reasoning_started = False
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

        # Lifecycle guarantee on the normal path: if a native thinking block
        # streamed content but its content_block_stop never arrived (e.g. the
        # stream ended early without raising), still close the reasoning
        # message so the UI doesn't render an in-flight thinking bubble.
        if native_reasoning_id is not None and native_reasoning_started:
            yield encoder.encode(
                ReasoningMessageEndEvent(
                    type=EventType.REASONING_MESSAGE_END,
                    message_id=native_reasoning_id,
                )
            )
            native_reasoning_id = None
            native_reasoning_started = False

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
                async for ev in emit_text(buffer):
                    yield ev
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

        if not tool_calls and response_text and not text_started:
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
                    delta=response_text,
                )
            )

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
        #
        # Anthropic requires that when continuing a tool-use conversation with
        # extended thinking enabled, the assistant turn that produced the
        # tool_use is re-sent with ALL of its ORIGINAL thinking blocks — each
        # including its `signature` — as the LEADING content blocks, in their
        # original stream order. Without them, iteration 2+ of the tool loop
        # fails with a 400 ("expected `thinking` ... as the first block /
        # signature required"). A turn may contain MORE THAN ONE thinking block
        # (and/or `redacted_thinking` blocks), so we replay the full
        # `thinking_blocks` list rather than only the last one. Each thinking
        # block's signature is accumulated from its `signature_delta` events
        # during streaming; redacted blocks carry their opaque `data`. (Under
        # aimock replay a signature is an empty string, preserved verbatim.)
        assistant_content: list[dict[str, Any]] = []
        # Type-only widening: TypedDict is invariant, so extending the
        # `dict[str, Any]` list with `list[ThinkingContentBlock]` needs an
        # explicit widen. No runtime/behavior change — the dicts are appended
        # verbatim in stream order, exactly as before.
        assistant_content.extend(cast("list[dict[str, Any]]", thinking_blocks))
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
