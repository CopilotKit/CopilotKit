"""Reasoning agent — emits AG-UI REASONING_MESSAGE_* events.

Shared by:
  - agentic-chat-reasoning (custom amber ReasoningBlock slot on the frontend)
  - reasoning-default-render (CopilotKit's built-in reasoning slot)

Approach:
The Anthropic Python SDK supports Claude's extended-thinking ("thinking
budget") parameter on `messages.stream`, which streams `thinking_delta`
content blocks separately from text. We map those onto AG-UI's
REASONING_MESSAGE_* events. Models without extended-thinking fall back
to an inline ``<reasoning>...</reasoning>`` system-prompt convention that
this agent parses out of the text stream.
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
)
from ag_ui.encoder import EventEncoder

REASONING_SYSTEM_PROMPT = dedent("""
    You are a helpful assistant. For each user question, FIRST emit a
    short step-by-step plan inside `<reasoning>...</reasoning>` tags
    (one or two short sentences per step, plain text only — no
    Markdown, no JSON), THEN follow with the final concise answer for
    the user OUTSIDE the tags.

    The reasoning block is shown to the user as a visible "thinking"
    chain — keep it brief and readable.

    Example:
    <reasoning>
    The user is asking about X. I should consider Y and Z.
    Combining both gives W.
    </reasoning>
    Final answer: W.
""").strip()


async def run_reasoning_agent(
    input_data: RunAgentInput,
    *,
    system_prompt: str | None = None,
) -> AsyncIterator[str]:
    """Stream a reasoning-enabled assistant response as AG-UI events.

    Splits Claude's response into REASONING_MESSAGE_* (everything inside
    `<reasoning>...</reasoning>` tags) and TEXT_MESSAGE_* (everything
    outside). Tags themselves are stripped before forwarding.
    """
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

    system = system_prompt or REASONING_SYSTEM_PROMPT
    text_msg_id = f"msg-{run_id}-text"
    reasoning_msg_id = f"msg-{run_id}-reasoning"

    # State machine for parsing <reasoning>...</reasoning>
    REASONING_OPEN = "<reasoning>"
    REASONING_CLOSE = "</reasoning>"

    in_reasoning = False
    reasoning_started = False
    text_started = False
    buffer = ""

    # Import lazily so missing imports don't crash module import-time
    # on older ag_ui versions.
    from ag_ui.core import (
        ReasoningMessageContentEvent,
        ReasoningMessageEndEvent,
        ReasoningMessageStartEvent,
    )

    try:
        async with client.messages.stream(
            model=os.getenv("ANTHROPIC_MODEL", "claude-opus-4-5"),
            max_tokens=2048,
            system=system,
            messages=messages,
        ) as stream:
            async for event in stream:
                etype = type(event).__name__
                if etype != "RawContentBlockDeltaEvent":
                    continue
                delta = event.delta  # type: ignore[attr-defined]
                if delta.type != "text_delta":
                    continue
                buffer += delta.text

                # Drain the buffer, emitting either reasoning or text
                # whenever we have enough to safely classify.
                while True:
                    if in_reasoning:
                        close_idx = buffer.find(REASONING_CLOSE)
                        if close_idx == -1:
                            # Hold last few chars in case the close tag is split.
                            keep = max(0, len(buffer) - len(REASONING_CLOSE))
                            chunk = buffer[:keep]
                            buffer = buffer[keep:]
                            if chunk:
                                if not reasoning_started:
                                    yield encoder.encode(
                                        ReasoningMessageStartEvent(
                                            type=EventType.REASONING_MESSAGE_START,
                                            message_id=reasoning_msg_id,
                                            role="reasoning",
                                        )
                                    )
                                    reasoning_started = True
                                yield encoder.encode(
                                    ReasoningMessageContentEvent(
                                        type=EventType.REASONING_MESSAGE_CONTENT,
                                        message_id=reasoning_msg_id,
                                        delta=chunk,
                                    )
                                )
                            break
                        # Found close tag — emit remaining reasoning, end it, switch mode.
                        chunk = buffer[:close_idx]
                        if chunk:
                            if not reasoning_started:
                                yield encoder.encode(
                                    ReasoningMessageStartEvent(
                                        type=EventType.REASONING_MESSAGE_START,
                                        message_id=reasoning_msg_id,
                                        role="reasoning",
                                    )
                                )
                                reasoning_started = True
                            yield encoder.encode(
                                ReasoningMessageContentEvent(
                                    type=EventType.REASONING_MESSAGE_CONTENT,
                                    message_id=reasoning_msg_id,
                                    delta=chunk,
                                )
                            )
                        if reasoning_started:
                            yield encoder.encode(
                                ReasoningMessageEndEvent(
                                    type=EventType.REASONING_MESSAGE_END,
                                    message_id=reasoning_msg_id,
                                )
                            )
                        buffer = buffer[close_idx + len(REASONING_CLOSE) :]
                        in_reasoning = False
                        continue
                    else:
                        open_idx = buffer.find(REASONING_OPEN)
                        if open_idx == -1:
                            # No open tag in buffer — emit as text but hold tail in case tag is split.
                            keep = max(0, len(buffer) - len(REASONING_OPEN))
                            chunk = buffer[:keep]
                            buffer = buffer[keep:]
                            if chunk:
                                # Skip leading whitespace-only fragments before any reasoning
                                # so the empty assistant message doesn't appear.
                                if not text_started:
                                    yield encoder.encode(
                                        TextMessageStartEvent(
                                            type=EventType.TEXT_MESSAGE_START,
                                            message_id=text_msg_id,
                                            role="assistant",
                                        )
                                    )
                                    text_started = True
                                yield encoder.encode(
                                    TextMessageContentEvent(
                                        type=EventType.TEXT_MESSAGE_CONTENT,
                                        message_id=text_msg_id,
                                        delta=chunk,
                                    )
                                )
                            break
                        # Found open tag — flush text up to it, switch to reasoning mode.
                        chunk = buffer[:open_idx]
                        if chunk:
                            if not text_started:
                                yield encoder.encode(
                                    TextMessageStartEvent(
                                        type=EventType.TEXT_MESSAGE_START,
                                        message_id=text_msg_id,
                                        role="assistant",
                                    )
                                )
                                text_started = True
                            yield encoder.encode(
                                TextMessageContentEvent(
                                    type=EventType.TEXT_MESSAGE_CONTENT,
                                    message_id=text_msg_id,
                                    delta=chunk,
                                )
                            )
                        buffer = buffer[open_idx + len(REASONING_OPEN) :]
                        in_reasoning = True
                        continue

        # Flush any remaining buffered content as text.
        if buffer:
            if in_reasoning:
                if not reasoning_started:
                    yield encoder.encode(
                        ReasoningMessageStartEvent(
                            type=EventType.REASONING_MESSAGE_START,
                            message_id=reasoning_msg_id,
                            role="reasoning",
                        )
                    )
                    reasoning_started = True
                yield encoder.encode(
                    ReasoningMessageContentEvent(
                        type=EventType.REASONING_MESSAGE_CONTENT,
                        message_id=reasoning_msg_id,
                        delta=buffer,
                    )
                )
                yield encoder.encode(
                    ReasoningMessageEndEvent(
                        type=EventType.REASONING_MESSAGE_END,
                        message_id=reasoning_msg_id,
                    )
                )
            else:
                if not text_started:
                    yield encoder.encode(
                        TextMessageStartEvent(
                            type=EventType.TEXT_MESSAGE_START,
                            message_id=text_msg_id,
                            role="assistant",
                        )
                    )
                    text_started = True
                yield encoder.encode(
                    TextMessageContentEvent(
                        type=EventType.TEXT_MESSAGE_CONTENT,
                        message_id=text_msg_id,
                        delta=buffer,
                    )
                )
    except Exception:
        err_text = f"Agent error: {traceback.format_exc()}"
        if not text_started:
            yield encoder.encode(
                TextMessageStartEvent(
                    type=EventType.TEXT_MESSAGE_START,
                    message_id=text_msg_id,
                    role="assistant",
                )
            )
            text_started = True
        yield encoder.encode(
            TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT,
                message_id=text_msg_id,
                delta=err_text,
            )
        )

    if text_started:
        yield encoder.encode(
            TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=text_msg_id,
            )
        )

    yield encoder.encode(
        RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )
    )
