"""
AG-UI SSE Adapter for Langroid

Implements the AG-UI protocol over SSE, translating between
Langroid's ChatAgent and the AG-UI event stream that CopilotKit expects.

AG-UI event types used:
  - RUN_STARTED / RUN_FINISHED
  - TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT / TEXT_MESSAGE_END
  - TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END
  - STATE_SNAPSHOT
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, AsyncGenerator

import pydantic
from ag_ui.core import (
    EventType,
    RunStartedEvent,
    RunFinishedEvent,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    ToolCallStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    StateSnapshotEvent,
    RunAgentInput,
)
from fastapi import Request
from fastapi.responses import StreamingResponse

from agents.agent import (
    create_agent,
    ALL_TOOLS,
    BACKEND_TOOLS,
    FRONTEND_TOOL_NAMES,
)

import langroid as lr
from langroid.agent.tool_message import ToolMessage


logger = logging.getLogger(__name__)


# Map tool name -> ToolMessage class for backend execution. Built once at
# import so a collision surfaces loudly at startup instead of silently
# shadowing a tool class at runtime.
#
# IMPORTANT: This map is late-bound at *import time* against the current
# contents of ``ALL_TOOLS``. Tools added to ``ALL_TOOLS`` *after* this
# module has been imported will NOT be discoverable by ``handle_run`` —
# the adapter will treat them as unknown and skip backend execution.
# If you need to register tools dynamically, rebuild this map explicitly.
_TOOL_BY_NAME: dict[str, type[ToolMessage]] = {
    cls.default_value("request"): cls for cls in ALL_TOOLS
}
if len(_TOOL_BY_NAME) != len(ALL_TOOLS):
    # Collisions are a programmer error — don't try to recover.
    seen: set[str] = set()
    dupes: list[str] = []
    for cls in ALL_TOOLS:
        name = cls.default_value("request")
        if name in seen:
            dupes.append(name)
        seen.add(name)
    raise RuntimeError(
        f"Duplicate tool request names in ALL_TOOLS: {dupes!r}"
    )


def _sse_line(event: Any) -> str:
    """Format an AG-UI event as an SSE data line (camelCase keys per AG-UI protocol)."""
    if hasattr(event, "model_dump"):
        data = event.model_dump(by_alias=True, exclude_none=True)
    else:
        data = dict(event)
    return f"data: {json.dumps(data)}\n\n"


def _parse_tool_args(raw_args: Any) -> dict | None:
    """Coerce tool-call arguments into a dict.

    OpenAI-style arguments arrive as a JSON string; Langroid sometimes
    passes a pre-parsed dict. Returns a fresh dict on success so callers
    are free to mutate without affecting the original payload.

    Returns:
        * ``{}`` when input is genuinely empty (``""``, ``None``, or an
          unknown non-dict/non-str type that has no arguments to parse).
        * A fresh ``dict`` copy on successful parse.
        * ``None`` when parsing was attempted but failed (malformed JSON
          or non-dict JSON payload). Callers should treat ``None`` as a
          DEGRADED signal and skip emitting the tool call — firing a
          tool with empty args produces a meaningless UI card.
    """
    if isinstance(raw_args, dict):
        # Return a shallow copy so callers may mutate safely.
        return dict(raw_args)
    if isinstance(raw_args, str):
        if not raw_args:
            return {}
        try:
            parsed = json.loads(raw_args)
        except json.JSONDecodeError as exc:
            truncated = raw_args[:200]
            logger.warning(
                "Failed to JSON-decode tool-call arguments (%s): %r", exc, truncated
            )
            return None
        if isinstance(parsed, dict):
            return parsed
        logger.warning(
            "Tool-call arguments parsed to non-dict (%s): %r",
            type(parsed).__name__,
            str(parsed)[:200],
        )
        return None
    return {}


async def handle_run(request: Request) -> StreamingResponse:
    """Handle an AG-UI /run endpoint — parse input, run agent, stream events."""
    body = await request.json()
    run_input = RunAgentInput(**body)

    agent = create_agent()

    # Build conversation history from all messages so multi-turn works
    conversation_parts: list[str] = []
    if run_input.messages:
        for msg in run_input.messages:
            if hasattr(msg, "role") and hasattr(msg, "content"):
                conversation_parts.append(f"{msg.role}: {msg.content}")
            elif isinstance(msg, dict):
                role = msg.get("role", "user")
                content = msg.get("content", "")
                conversation_parts.append(f"{role}: {content}")
    user_message = "\n".join(conversation_parts) if conversation_parts else ""

    # Compute the effective thread_id ONCE so every event emitted for this
    # run (RUN_STARTED, RUN_FINISHED, ...) references the same thread.
    # Previously RUN_STARTED synthesized a fresh UUID while RUN_FINISHED
    # fell back to "" on the same missing-thread_id input.
    thread_id = run_input.thread_id or str(uuid.uuid4())

    async def event_stream() -> AsyncGenerator[str, None]:
        run_id = str(uuid.uuid4())
        message_id = str(uuid.uuid4())

        def emit_text_block(msg_id: str, text: str) -> list[str]:
            """Emit a complete TEXT_MESSAGE_{START,CONTENT,END} triple.

            AG-UI requires TextMessageContentEvent.delta to be non-empty,
            so this helper short-circuits when `text` is falsy — no events
            are emitted at all. Returns the SSE lines so the generator can
            yield them in order.
            """
            if not text:
                return []
            return [
                _sse_line(TextMessageStartEvent(
                    type=EventType.TEXT_MESSAGE_START,
                    message_id=msg_id,
                )),
                _sse_line(TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=msg_id,
                    delta=text,
                )),
                _sse_line(TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END,
                    message_id=msg_id,
                )),
            ]

        yield _sse_line(RunStartedEvent(
            type=EventType.RUN_STARTED,
            thread_id=thread_id,
            run_id=run_id,
        ))

        # Run the Langroid agent
        response = await agent.llm_response_async(user_message)

        if response is None:
            # Empty response — just finish
            yield _sse_line(RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id,
            ))
            return

        # `response` is a Langroid ChatDocument. `.content` is the canonical
        # source of text; `str(response)` includes debug formatting and is
        # not a useful fallback, so default to "" when content is absent.
        content = getattr(response, "content", None) or ""

        # Langroid's OpenAI-backed LLM emits tool calls on
        # `response.oai_tool_calls` (OpenAI tools API) or `response.function_call`
        # (legacy function-calling API) with empty `content`. We must synthesize
        # AG-UI TOOL_CALL_* events from those so CopilotKit's frontend can
        # render the tool card (weather, haiku, etc.).
        oai_tool_calls = getattr(response, "oai_tool_calls", None) or []
        function_call = getattr(response, "function_call", None)

        if oai_tool_calls or function_call:
            # Emit synthesized tool-call events for each OAI tool call.
            # ``_parse_tool_args`` returns ``None`` when args could not be
            # parsed — in that case we SKIP the tool call entirely rather
            # than emitting a call with ``{}`` (which renders a meaningless
            # UI card). The warning already fired inside _parse_tool_args.
            calls_to_emit = []
            if oai_tool_calls:
                for tc in oai_tool_calls:
                    fn = getattr(tc, "function", None)
                    name = getattr(fn, "name", None) if fn is not None else None
                    raw_args = getattr(fn, "arguments", {}) if fn is not None else {}
                    args_dict = _parse_tool_args(raw_args)
                    call_id = getattr(tc, "id", None) or str(uuid.uuid4())
                    if name and args_dict is not None:
                        calls_to_emit.append((call_id, name, args_dict))
                    elif name:
                        logger.warning(
                            "Skipping tool call %s: arguments could not be parsed",
                            name,
                        )
            elif function_call is not None:
                # Legacy function_call shape: single call.
                name = getattr(function_call, "name", None)
                raw_args = getattr(function_call, "arguments", {}) or {}
                args_dict = _parse_tool_args(raw_args)
                if name and args_dict is not None:
                    calls_to_emit.append((str(uuid.uuid4()), name, args_dict))
                elif name:
                    logger.warning(
                        "Skipping tool call %s: arguments could not be parsed",
                        name,
                    )

            for call_id, tool_name, tool_args in calls_to_emit:
                yield _sse_line(ToolCallStartEvent(
                    type=EventType.TOOL_CALL_START,
                    tool_call_id=call_id,
                    tool_call_name=tool_name,
                ))

                yield _sse_line(ToolCallArgsEvent(
                    type=EventType.TOOL_CALL_ARGS,
                    tool_call_id=call_id,
                    delta=json.dumps(tool_args),
                ))

                yield _sse_line(ToolCallEndEvent(
                    type=EventType.TOOL_CALL_END,
                    tool_call_id=call_id,
                ))

                # For backend tools, execute and stream the result as text.
                if tool_name not in FRONTEND_TOOL_NAMES:
                    tool_cls = _TOOL_BY_NAME.get(tool_name)
                    result: str | None = None
                    if tool_cls is not None:
                        try:
                            tool_instance = tool_cls(**tool_args)
                            result = await asyncio.to_thread(tool_instance.handle)
                        except (
                            RuntimeError,
                            ValueError,
                            TypeError,
                            KeyError,
                            pydantic.ValidationError,
                        ) as exc:
                            # Log the full traceback server-side (logger.exception
                            # captures it automatically) so we can debug tool
                            # failures, but keep the user-facing payload
                            # sanitized — no stack, no internals, no ``str(exc)``
                            # (which often embeds file paths, connection strings,
                            # or full frames). Only the tool name and the
                            # exception class name leak.
                            logger.exception(
                                "Tool %s execution failed", tool_name
                            )
                            result = json.dumps({
                                "error": (
                                    f"Tool {tool_name} failed: "
                                    f"{exc.__class__.__name__}"
                                )
                            })

                    if result:
                        msg_id = str(uuid.uuid4())
                        for line in emit_text_block(msg_id, result):
                            yield line

            yield _sse_line(RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id,
            ))
            return

        # Check if the response contains a tool call parsed from content
        tool_msg = _try_parse_tool(content, agent)

        if tool_msg is not None:
            tool_name = tool_msg.default_value("request") if hasattr(tool_msg, "default_value") else getattr(tool_msg, "request", "unknown")
            tool_call_id = str(uuid.uuid4())

            # Build tool arguments (exclude metadata fields and unset/None
            # values — emitting ``{"foo": null}`` forces the frontend to
            # decide what a null field means, which almost always renders
            # as an empty input on the tool card).
            tool_args = {}
            for field_name, field_info in tool_msg.model_fields.items():
                if field_name in ("request", "purpose", "result"):
                    continue
                value = getattr(tool_msg, field_name)
                if value is None:
                    continue
                tool_args[field_name] = value

            yield _sse_line(ToolCallStartEvent(
                type=EventType.TOOL_CALL_START,
                tool_call_id=tool_call_id,
                tool_call_name=tool_name,
            ))

            yield _sse_line(ToolCallArgsEvent(
                type=EventType.TOOL_CALL_ARGS,
                tool_call_id=tool_call_id,
                delta=json.dumps(tool_args),
            ))

            yield _sse_line(ToolCallEndEvent(
                type=EventType.TOOL_CALL_END,
                tool_call_id=tool_call_id,
            ))

            # If it's a backend tool, execute it and stream the result as text
            if tool_name not in FRONTEND_TOOL_NAMES:
                result = await asyncio.to_thread(tool_msg.handle)
                for line in emit_text_block(message_id, result):
                    yield line
        else:
            # Plain text response — stream it. emit_text_block handles the
            # empty-delta guard (AG-UI requires non-empty deltas, e.g. a
            # pure tool-call turn where content was stripped to "").
            for line in emit_text_block(message_id, content):
                yield line

        yield _sse_line(RunFinishedEvent(
            type=EventType.RUN_FINISHED,
            thread_id=thread_id,
            run_id=run_id,
        ))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _try_parse_tool(content: str, agent: lr.ChatAgent) -> ToolMessage | None:
    """Try to parse a Langroid ToolMessage from the LLM response content.

    Langroid's `agent.agent_response()` returns a `ChatDocument`, not a
    `ToolMessage`, so the previous isinstance-based path was effectively
    dead code. We rely on the JSON fallback, which matches both the
    Langroid tool envelope (`{"request": ..., ...}`) and the OpenAI
    function-call shape (`{"name": ..., "arguments": ...}`).

    Logging philosophy (matters — this is on the hot path for every
    turn, including plain chat replies like "hello"):

      * JSON decode failure is the common case (plain text). SILENT.
        Returning ``None`` is the signal.
      * JSON decoded but didn't match any tool schema: ``debug`` log.
        Still not interesting for ops dashboards.
      * JSON decoded AND matched a tool name BUT instantiation failed:
        ``warning`` log. This is the one that actually deserves
        attention — the model tried to call a tool and the payload
        was bad.
    """
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        # Common case: plain text (e.g. "hello"). Silent — logging
        # every chat turn as a warning drowns the real signal.
        return None

    # At this point we parsed valid JSON. Whether it's a tool call or
    # just arbitrary JSON-shaped content is what we find out next.
    request = data.get("request") if isinstance(data, dict) else None
    if request:
        for tool_cls in ALL_TOOLS:
            if tool_cls.default_value("request") == request:
                try:
                    return tool_cls(**data)
                except (
                    TypeError,
                    ValueError,
                    KeyError,
                    pydantic.ValidationError,
                    pydantic.errors.PydanticUserError,
                ) as exc:
                    logger.warning(
                        "Failed to instantiate tool %s from parsed content "
                        "(%s: %s): %r",
                        request,
                        exc.__class__.__name__,
                        exc,
                        str(data)[:200],
                    )
                    return None

    # Check for OpenAI function_call style
    if isinstance(data, dict):
        name = data.get("name") or (data.get("function", {}) or {}).get("name")
        args = data.get("arguments") or (data.get("function", {}) or {}).get("arguments", {})
        if name:
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError as exc:
                    logger.warning(
                        "Failed to JSON-decode function_call.arguments (%s): %r",
                        exc,
                        args[:200],
                    )
                    return None
            for tool_cls in ALL_TOOLS:
                if tool_cls.default_value("request") == name:
                    try:
                        return tool_cls(**args)
                    except (
                        TypeError,
                        ValueError,
                        KeyError,
                        pydantic.ValidationError,
                        pydantic.errors.PydanticUserError,
                    ) as exc:
                        logger.warning(
                            "Failed to instantiate tool %s from "
                            "function_call (%s: %s): %r",
                            name,
                            exc.__class__.__name__,
                            exc,
                            str(data)[:200],
                        )
                        return None

    # Valid JSON but no tool match — not interesting enough for warning.
    logger.debug(
        "LLM content parsed as JSON but did not match any tool schema: %r",
        str(data)[:200],
    )
    return None
