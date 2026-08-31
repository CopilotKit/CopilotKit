"""AG2 reasoning agent — emits AG-UI REASONING_MESSAGE_* events.

Backs two showcase cells (both share this one backend):
    - reasoning-custom   (custom amber ReasoningBlock slot)
    - reasoning-default  (CopilotKit's built-in reasoning card)

Mirrors `showcase/integrations/agno/src/agents/reasoning_agent.py` plus its
`/reasoning/agui` server mount in `agno/src/agent_server.py`, adapted to AG2.

Why a custom route instead of the stock AGUIStream
--------------------------------------------------
AG2's stock `AGUIStream` (autogen.ag_ui) streams the model's text as
TEXT_MESSAGE_CONTENT and emits NO REASONING_MESSAGE_* events. Worse,
autogen's `ConversableAgent` consumes only `delta.content` / `delta.tool_calls`
from the OpenAI chat-completions stream — it drops the `delta.reasoning_content`
side-channel entirely (the channel aimock fixtures populate via their
`reasoning` field, and that reasoning models emit in production). So the stock
adapter can never light up CopilotKit's reasoning slot.

This module builds a small custom `/reasoning` sub-app (mounted by
`agent_server.py`, mirroring agno's `_run_reasoning_agent`) that:
  1. Calls the OpenAI-compatible chat-completions endpoint directly
     (streaming) with the agent's system prompt plus the full prior
     conversation history (so follow-up questions keep their context, parity
     with the agno reference) — a single LLM call, so it stays
     aimock-friendly (no multi-call CoT loop).
  2. Buffers the FULL upstream response, accumulating BOTH
     `delta.reasoning_content` (native reasoning channel, what aimock's
     `reasoning` field feeds) AND `delta.content` (the answer); it does not
     forward upstream deltas incrementally.
  3. Falls back to parsing <reasoning>...</reasoning> tags out of the text
     when no native reasoning channel is present (defensive parity with
     agno's fallback path).
  4. Emits each channel as a single CONTENT delta:
     REASONING_MESSAGE_START/CONTENT/END for the buffered reasoning portion,
     then TEXT_MESSAGE_START/CONTENT/END for the buffered answer.

The emitted channel is REASONING_MESSAGE_* (role "reasoning") — NOT THINKING_*,
which @ag-ui/client silently drops.

The global httpx hook installed in agent_server.py forwards the inbound
`x-aimock-context` header onto the outbound OpenAI call so aimock matches the
ag2-scoped fixture.
"""

from __future__ import annotations

import asyncio
import re
import sys
import traceback
import uuid
from typing import AsyncIterator

import openai
from ag_ui.core import (
    BaseEvent,
    EventType,
    ReasoningMessageContentEvent,
    ReasoningMessageEndEvent,
    ReasoningMessageStartEvent,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui.encoder import EventEncoder
from fastapi import FastAPI
from starlette.endpoints import HTTPEndpoint
from starlette.requests import Request
from starlette.responses import StreamingResponse

SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer."
)

MODEL = "gpt-4o-mini"

_REASONING_PATTERN = re.compile(
    r"<reasoning>(.*?)</reasoning>",
    re.DOTALL | re.IGNORECASE,
)


def _coerce_content(content) -> str:
    """Coerce an AG-UI message's content into a plain string.

    Handles the multimodal list shape (join the text parts) and the
    None/non-string fallbacks — the same coercion the previous
    single-turn `_extract_user_input` applied to the last user message.
    """
    content = content or ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        # Multimodal content: join the text parts. Coerce each part's text to
        # a string — a None or non-str `text` (e.g. an image part) would make
        # str.join raise TypeError, so fall back to "" for any non-str value.
        def _part_text(part) -> str:
            text = (
                part.get("text", "")
                if isinstance(part, dict)
                else getattr(part, "text", "")
            )
            return text if isinstance(text, str) else ""

        return "".join(_part_text(part) for part in content)
    return str(content)


def _to_chat_messages(messages: list) -> list:
    """Map the AG-UI message list into chat-completions `messages`.

    System prompt first, then every prior user/assistant turn (in order)
    with its coerced text content. tool/system messages from the input are
    skipped — only the conversation turns are threaded so follow-up
    questions keep their context (parity with the agno reference, which
    threads full history through Agno's Agent).

    For a single user-message input this returns exactly
    ``[{system}, {user: <text>}]`` — byte-equal to the previous single-turn
    behaviour, which the aimock D6 fixtures replay. When the input has no
    user/assistant turns the result is ``[{system}, {user: ""}]`` (an empty
    user turn), preserving the prior empty-input behaviour.
    """
    chat: list = [{"role": "system", "content": SYSTEM_PROMPT}]
    turns = [
        {"role": role, "content": _coerce_content(getattr(msg, "content", ""))}
        for msg in (messages or [])
        for role in (getattr(msg, "role", None),)
        if role in ("user", "assistant")
    ]
    if turns:
        chat.extend(turns)
    else:
        chat.append({"role": "user", "content": ""})
    return chat


async def _run_reasoning_agent(
    run_input: RunAgentInput,
) -> AsyncIterator[BaseEvent]:
    """Stream one reasoning run, synthesizing REASONING_MESSAGE_* events.

    Mirrors agno's `_run_reasoning_agent`: buffer the full response, split
    reasoning from answer, emit REASONING_MESSAGE_* then TEXT_MESSAGE_*.
    """
    run_id = run_input.run_id or str(uuid.uuid4())
    thread_id = run_input.thread_id

    # Track the in-flight message frame so a mid-stream failure can close it
    # with the matching *_END before RUN_ERROR. @ag-ui/client's verifyEvents
    # rejects a RUN_FINISHED while a text/tool frame is open, and the apply
    # layer otherwise leaves a half-built message in client state.
    reasoning_msg_id: str | None = None
    text_msg_id: str | None = None

    try:
        chat_messages = _to_chat_messages(run_input.messages or [])

        yield RunStartedEvent(
            type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id
        )

        # Single streaming chat-completions call. The global httpx hook
        # (installed in agent_server.py) forwards x-aimock-context so aimock
        # matches the ag2-scoped fixture. OPENAI_BASE_URL points the client at
        # aimock in local/D6 runs and at the real API in production.
        client = openai.AsyncOpenAI()
        response_stream = await client.chat.completions.create(
            model=MODEL,
            messages=chat_messages,
            stream=True,
        )

        # Accumulate both channels. autogen drops reasoning_content, so we read
        # the chat-completions stream directly to capture it.
        full_text = ""
        native_reasoning = ""
        async for chunk in response_stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta is None:
                continue
            # Native reasoning channel — aimock `reasoning` field / reasoning
            # models surface this as delta.reasoning_content.
            reasoning_piece = getattr(delta, "reasoning_content", None)
            if reasoning_piece:
                native_reasoning += reasoning_piece
            if delta.content:
                full_text += delta.content

        native_reasoning = native_reasoning.strip()

        if native_reasoning:
            # Native channel present — gold-standard parity path. The answer is
            # the streamed text minus any stray <reasoning> tags.
            reasoning_text = native_reasoning
            answer_text = _REASONING_PATTERN.sub("", full_text).strip()
        else:
            # Fallback: parse <reasoning>...</reasoning> tags from the text
            # (non-reasoning models / no-native-reasoning fixtures).
            match = _REASONING_PATTERN.search(full_text)
            if match:
                reasoning_text = match.group(1).strip()
                answer_text = (
                    full_text[: match.start()] + full_text[match.end() :]
                ).strip()
            else:
                reasoning_text = ""
                answer_text = full_text.strip()

        # The stream completed successfully but yielded neither reasoning nor
        # answer text — the run would otherwise emit RUN_STARTED→RUN_FINISHED
        # with zero message frames and no diagnostics. Log one server-side warn
        # so a silent-empty run is visible (no synthetic message frames).
        if not reasoning_text and not answer_text:
            print(
                "[reasoning] WARN: stream completed but produced no reasoning"
                " or answer text",
                file=sys.stderr,
                flush=True,
            )

        # Emit reasoning message if we have reasoning content.
        if reasoning_text:
            reasoning_msg_id = str(uuid.uuid4())
            yield ReasoningMessageStartEvent(
                type=EventType.REASONING_MESSAGE_START,
                message_id=reasoning_msg_id,
                role="reasoning",
            )
            yield ReasoningMessageContentEvent(
                type=EventType.REASONING_MESSAGE_CONTENT,
                message_id=reasoning_msg_id,
                delta=reasoning_text,
            )
            yield ReasoningMessageEndEvent(
                type=EventType.REASONING_MESSAGE_END,
                message_id=reasoning_msg_id,
            )
            reasoning_msg_id = None

        # Emit a text message (only when non-empty answer text exists) so
        # CopilotKit renders an assistant bubble.
        if answer_text:
            text_msg_id = str(uuid.uuid4())
            yield TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=text_msg_id,
                role="assistant",
            )
            yield TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT,
                message_id=text_msg_id,
                delta=answer_text,
            )
            yield TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=text_msg_id,
            )
            text_msg_id = None

        yield RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )

    except asyncio.CancelledError:  # noqa: TRY302 — propagate cancellation
        raise
    except Exception as exc:  # noqa: BLE001
        # Log the full failure server-side (never sent to the browser).
        print(f"[reasoning] run failed: {exc!r}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        # Close any message frame opened before the failure so the terminal
        # RUN_ERROR is protocol-clean (no dangling *_START in client state).
        if text_msg_id is not None:
            yield TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=text_msg_id,
            )
        if reasoning_msg_id is not None:
            yield ReasoningMessageEndEvent(
                type=EventType.REASONING_MESSAGE_END,
                message_id=reasoning_msg_id,
            )
        # Generic client-facing message — no raw exception text (which can
        # carry provider URLs / request details) reaches the SSE stream.
        # RUN_ERROR is terminal: @ag-ui/client's verifyEvents rejects ANY
        # event after it, so we do NOT emit RUN_FINISHED here.
        yield RunErrorEvent(
            type=EventType.RUN_ERROR,
            message=f"agent run failed: {type(exc).__name__} (see server logs)",
        )


class ReasoningEndpoint(HTTPEndpoint):
    """Starlette HTTPEndpoint that emits REASONING_MESSAGE_* + TEXT_MESSAGE_*.

    Mounted at the sub-app root (``reasoning_app.mount("/", ...)``) — the exact
    same shape as AG2's stock ``AGUIStream.build_asgi()`` HTTPEndpoint that the
    other ag2 sub-apps mount (see e.g. ``interrupt_agent.py``). agent_server
    mounts this sub-app at ``/reasoning``; the HttpAgent posts to
    ``/reasoning/`` (route.ts ``createAgent("/reasoning/")``), so the outer
    Mount strips ``/reasoning`` and the inner Mount at ``/`` resolves here.
    """

    async def post(self, request: Request) -> StreamingResponse:
        encoder = EventEncoder()
        run_input = RunAgentInput.model_validate_json(await request.body())

        async def _gen() -> AsyncIterator[str]:
            async for event in _run_reasoning_agent(run_input):
                yield encoder.encode(event)

        return StreamingResponse(
            _gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
        )


# FastAPI sub-app so agent_server.py can mount at /reasoning. Mounting the
# HTTPEndpoint at "/" mirrors the stock AGUIStream sub-apps
# (``app.mount("/", stream.build_asgi())``) — the HttpAgent posts to
# ``/reasoning/`` so the outer Mount strips ``/reasoning`` and this inner
# Mount at ``/`` resolves the endpoint.
reasoning_app = FastAPI(title="AG2 Reasoning Agent")
reasoning_app.mount("/", ReasoningEndpoint)
