"""Shared State (Read + Write) demo — Langroid.

Mirrors langgraph-python/src/agents/shared_state_read_write.py: full
bidirectional shared-state pattern between UI and agent.

- **UI -> agent (write)**: the UI owns a ``preferences`` object (name,
  tone, language, interests) and writes it into agent state via
  ``agent.setState(...)`` from the React side. Every turn we read those
  preferences out of ``RunAgentInput.state`` and prepend a system message
  describing them, so the LLM adapts its response.
- **agent -> UI (read)**: the agent calls a ``set_notes`` tool to replace
  the ``notes`` slice of shared state. The UI subscribes via ``useAgent``
  and re-renders.

Langroid does not provide a native shared-state channel — we implement
it directly on top of AG-UI's ``STATE_SNAPSHOT`` event by emitting a
fresh snapshot whenever the agent mutates state.

The handler is wired up by ``agent_server.py`` at ``POST
/shared-state-read-write``.

LLM calls use the OpenAI client directly (not langroid's agent
abstraction) so that aimock can intercept and fixture-match requests by
message history shape (including ``hasToolResult`` matching on
``role: "tool"`` messages in the follow-up turn). The tool definition
for ``set_notes`` is passed as an OpenAI-format tool spec.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any, AsyncGenerator

from ag_ui.core import (
    EventType,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse

import openai

logger = logging.getLogger(__name__)


# =====================================================================
# State shape (mirrors the UI's RWAgentState)
# =====================================================================
#
# {
#   "preferences": { "name", "tone", "language", "interests": [...] },
#   "notes":       [str, ...]
# }
#
# `preferences` is owned by the UI. The agent only READS it.
# `notes` is owned by the agent. The agent calls `set_notes` to replace
# the array; the UI re-renders from shared state.


_VALID_TONES = frozenset({"formal", "casual", "playful"})


def _normalize_state(raw: Any) -> dict[str, Any]:
    """Coerce the inbound RunAgentInput.state into our canonical dict.

    AG-UI types ``state`` as ``Any``, so a malformed frontend (or a
    test fixture) could ship anything from ``None`` to a list. Anything
    that isn't a dict is treated as "no state" — we don't try to recover
    structure from it.
    """
    if not isinstance(raw, dict):
        return {"preferences": {}, "notes": []}

    prefs = raw.get("preferences") if isinstance(raw.get("preferences"), dict) else {}
    notes_raw = raw.get("notes")
    notes = (
        [n for n in notes_raw if isinstance(n, str)]
        if isinstance(notes_raw, list)
        else []
    )
    return {"preferences": prefs, "notes": notes}


def build_preferences_system_message(prefs: dict[str, Any]) -> str | None:
    """Render the UI-supplied preferences into a system-message string.

    Returns ``None`` when no preference is set so the caller can skip
    injection cleanly. Tone is sanitized against a closed set; unknown
    values are silently dropped (matches the agent-config demo's
    posture: a frontend bug should not 500 a turn).
    """
    if not prefs:
        return None
    lines: list[str] = ["The user has shared these preferences with you:"]
    name = prefs.get("name")
    if isinstance(name, str) and name:
        lines.append(f"- Name: {name}")
    tone = prefs.get("tone")
    if isinstance(tone, str) and tone in _VALID_TONES:
        lines.append(f"- Preferred tone: {tone}")
    language = prefs.get("language")
    if isinstance(language, str) and language:
        lines.append(f"- Preferred language: {language}")
    interests = prefs.get("interests")
    if isinstance(interests, list):
        items = [i for i in interests if isinstance(i, str) and i]
        if items:
            lines.append(f"- Interests: {', '.join(items)}")
    if len(lines) == 1:
        # No usable keys — caller can skip injection.
        return None
    lines.append(
        "Tailor every response to these preferences. Address the user "
        "by name when appropriate."
    )
    return "\n".join(lines)


# =====================================================================
# `set_notes` tool — OpenAI function spec for the tool the agent uses
# to write the notes slice of shared state.
# =====================================================================

_SET_NOTES_TOOL_SPEC: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "set_notes",
        "description": (
            "Replace the notes array in shared state with the FULL updated "
            "list of short note strings (existing notes + any new ones). Use "
            "whenever the user asks you to remember something, or when you "
            "observe something worth surfacing in the UI's notes panel. Keep "
            "each note short (< 120 chars)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "notes": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "The complete list of notes after the update. Always "
                        "include every previously-recorded note you want to "
                        "keep — this REPLACES the array."
                    ),
                },
            },
            "required": ["notes"],
        },
    },
}


_SYSTEM_PROMPT = (
    "You are a helpful, concise assistant. The user's preferences are "
    "supplied via shared state and will be added as a system message at "
    "the start of every turn — always respect them.\n\n"
    "When the user asks you to remember something, or when you observe "
    "something worth surfacing in the UI's notes panel, call the "
    "`set_notes` tool with the FULL updated list of short note strings "
    "(existing notes + any new ones). NEVER pass a partial diff — always "
    "the complete list.\n\n"
    "Keep your prose replies brief — 1-2 sentences."
)


async def _call_openai(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
) -> Any:
    """Call the OpenAI chat completions API directly.

    Uses ``openai.AsyncOpenAI()`` which reads ``OPENAI_API_KEY`` and
    ``OPENAI_BASE_URL`` from the environment (aimock sets the base URL
    in the showcase). Returns the first choice's message object.

    When ``tools`` is None or empty, omits the tools parameter so the
    follow-up call (no tool needed) doesn't confuse the model into
    re-calling tools.
    """
    model = os.getenv("LANGROID_MODEL", "gpt-4.1")
    client = openai.AsyncOpenAI()
    response = await client.chat.completions.create(
        model=model,
        messages=messages,
        tools=tools if tools else openai.NOT_GIVEN,
    )
    return response.choices[0].message


# =====================================================================
# AG-UI SSE handler
# =====================================================================


def _sse_line(event: Any) -> str:
    if hasattr(event, "model_dump"):
        data = event.model_dump(by_alias=True, exclude_none=True)
    else:
        data = dict(event)
    return f"data: {json.dumps(data)}\n\n"


def _agui_messages_to_openai(
    messages: Any,
    system_prompt: str,
) -> list[dict[str, Any]]:
    """Convert AG-UI messages to OpenAI chat completion format.

    Preserves structured fields (tool_calls, tool_call_id) so aimock's
    ``hasToolResult`` fixture matcher can detect ``role: "tool"`` messages
    in follow-up turns. Mirrors ``agui_adapter._agui_messages_to_openai``.
    """
    oai_msgs: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
    ]

    if not messages:
        return oai_msgs

    for msg in messages:
        role = getattr(msg, "role", None)
        if not isinstance(role, str):
            if isinstance(msg, dict):
                role = msg.get("role")
            if not isinstance(role, str):
                continue

        if role == "tool":
            tool_call_id = getattr(msg, "tool_call_id", None)
            if isinstance(msg, dict):
                tool_call_id = tool_call_id or msg.get("tool_call_id")
            content = getattr(msg, "content", "") or ""
            if isinstance(msg, dict):
                content = content or msg.get("content", "")
            if tool_call_id:
                oai_msgs.append(
                    {
                        "role": "tool",
                        "tool_call_id": str(tool_call_id),
                        "content": str(content),
                    }
                )
            continue

        if role == "assistant":
            content = getattr(msg, "content", None)
            if isinstance(msg, dict):
                content = content or msg.get("content")
            tool_calls_raw = getattr(msg, "tool_calls", None)
            if isinstance(msg, dict):
                tool_calls_raw = tool_calls_raw or msg.get("tool_calls")

            oai_msg: dict[str, Any] = {"role": "assistant"}
            if content:
                oai_msg["content"] = str(content)
            if tool_calls_raw:
                oai_tcs = []
                for tc in tool_calls_raw:
                    tc_id = getattr(tc, "id", None)
                    fn = getattr(tc, "function", None)
                    if fn is None and isinstance(tc, dict):
                        fn_name = tc.get("function", {}).get("name", "")
                        fn_args = tc.get("function", {}).get("arguments", "")
                        tc_id = tc_id or tc.get("id", "")
                    else:
                        fn_name = getattr(fn, "name", "") if fn else ""
                        fn_args = getattr(fn, "arguments", "") if fn else ""
                    if tc_id and fn_name:
                        oai_tcs.append(
                            {
                                "id": str(tc_id),
                                "type": "function",
                                "function": {
                                    "name": str(fn_name),
                                    "arguments": str(fn_args),
                                },
                            }
                        )
                if oai_tcs:
                    oai_msg["tool_calls"] = oai_tcs
                    if "content" not in oai_msg:
                        oai_msg["content"] = None
            else:
                if "content" not in oai_msg:
                    oai_msg["content"] = ""
            oai_msgs.append(oai_msg)
            continue

        if role in ("user", "system", "developer"):
            content = getattr(msg, "content", None)
            if isinstance(msg, dict):
                content = content or msg.get("content")
            if content is not None:
                oai_msgs.append(
                    {
                        "role": role,
                        "content": str(content),
                    }
                )
            continue

    return oai_msgs


def _extract_set_notes_args(response: Any) -> tuple[list[str] | None, str | None]:
    """Pull a ``set_notes`` tool call out of an OpenAI ChatCompletionMessage.

    Returns ``(notes, tool_call_id)`` when the response contains a
    ``set_notes`` call; returns ``(None, None)`` otherwise so the caller
    can fall through to plain-text streaming. The ``tool_call_id`` is
    needed to build the follow-up ``role: "tool"`` result message.
    """
    tool_calls = getattr(response, "tool_calls", None) or []
    for tc in tool_calls:
        fn = getattr(tc, "function", None)
        name = getattr(fn, "name", None) if fn is not None else None
        if name != "set_notes":
            continue
        tc_id = getattr(tc, "id", None)
        raw_args = getattr(fn, "arguments", None) if fn is not None else None
        args: Any = raw_args
        if isinstance(raw_args, (str, bytes, bytearray)):
            try:
                args = json.loads(raw_args)
            except (ValueError, TypeError):
                return None, None
        if isinstance(args, dict):
            notes = args.get("notes")
            if isinstance(notes, list):
                return [n for n in notes if isinstance(n, str)], tc_id
    return None, None


async def handle_run(request: Request) -> StreamingResponse:
    """Handle one AG-UI ``/shared-state-read-write`` request.

    Uses the OpenAI client directly (not langroid's agent abstraction)
    so that aimock can fixture-match requests by full message history,
    including ``hasToolResult`` matching on ``role: "tool"`` messages
    in the follow-up turn after a ``set_notes`` tool call.
    """
    error_id = str(uuid.uuid4())
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError) as exc:
        logger.exception(
            "shared-state-read-write: failed to parse body (error_id=%s)",
            error_id,
        )
        return JSONResponse(
            {
                "error": "Invalid JSON body",
                "errorId": error_id,
                "class": exc.__class__.__name__,
            },
            status_code=400,
        )
    try:
        run_input = RunAgentInput(**body)
    except Exception as exc:  # noqa: BLE001 — pydantic.ValidationError is fine here
        logger.exception(
            "shared-state-read-write: invalid RunAgentInput (error_id=%s)",
            error_id,
        )
        return JSONResponse(
            {
                "error": "Invalid RunAgentInput payload",
                "errorId": error_id,
                "class": exc.__class__.__name__,
            },
            status_code=422,
        )

    state = _normalize_state(run_input.state)
    prefs_msg = build_preferences_system_message(state.get("preferences") or {})
    system_message = _SYSTEM_PROMPT
    if prefs_msg is not None:
        system_message = f"{_SYSTEM_PROMPT}\n\n{prefs_msg}"

    # Build OpenAI-format messages from the AG-UI message history.
    oai_messages = _agui_messages_to_openai(run_input.messages or [], system_message)
    thread_id = run_input.thread_id or str(uuid.uuid4())

    async def event_stream() -> AsyncGenerator[str, None]:
        run_id = str(uuid.uuid4())

        yield _sse_line(
            RunStartedEvent(
                type=EventType.RUN_STARTED,
                thread_id=thread_id,
                run_id=run_id,
            )
        )

        # Echo the inbound state back as the initial snapshot so the UI's
        # subscription always has a known-good baseline (and so a fresh
        # session sees the empty `notes` array even before the agent
        # writes one).
        yield _sse_line(
            StateSnapshotEvent(
                type=EventType.STATE_SNAPSHOT,
                snapshot=state,
            )
        )

        try:
            response = await _call_openai(oai_messages, [_SET_NOTES_TOOL_SPEC])
        except Exception as exc:  # noqa: BLE001 — surface as RunError + finish
            logger.exception("shared-state-read-write: _call_openai failed")
            yield _sse_line(
                RunErrorEvent(
                    type=EventType.RUN_ERROR,
                    message=f"Agent run failed: {exc.__class__.__name__}",
                )
            )
            yield _sse_line(
                RunFinishedEvent(
                    type=EventType.RUN_FINISHED,
                    thread_id=thread_id,
                    run_id=run_id,
                )
            )
            return

        if response is None:
            yield _sse_line(
                RunFinishedEvent(
                    type=EventType.RUN_FINISHED,
                    thread_id=thread_id,
                    run_id=run_id,
                )
            )
            return

        new_notes, oai_tool_call_id = _extract_set_notes_args(response)

        if new_notes is not None:
            # The agent decided to update the notes array. Apply, then
            # ack via tool-call events + a fresh STATE_SNAPSHOT so the
            # UI re-renders.
            state["notes"] = new_notes
            tool_call_id = oai_tool_call_id or str(uuid.uuid4())
            yield _sse_line(
                ToolCallStartEvent(
                    type=EventType.TOOL_CALL_START,
                    tool_call_id=tool_call_id,
                    tool_call_name="set_notes",
                )
            )
            yield _sse_line(
                ToolCallArgsEvent(
                    type=EventType.TOOL_CALL_ARGS,
                    tool_call_id=tool_call_id,
                    delta=json.dumps({"notes": new_notes}),
                )
            )
            yield _sse_line(
                ToolCallEndEvent(
                    type=EventType.TOOL_CALL_END,
                    tool_call_id=tool_call_id,
                )
            )
            yield _sse_line(
                StateSnapshotEvent(
                    type=EventType.STATE_SNAPSHOT,
                    snapshot=state,
                )
            )

            # Build the follow-up message array with the tool result
            # appended, so aimock can match it with hasToolResult: true.
            # This mirrors LangGraph's tool execution loop: the assistant
            # message (with tool_calls) + the tool result message go back
            # to the LLM for the natural-language acknowledgement.
            raw_args = (
                getattr(
                    getattr(response.tool_calls[0], "function", None), "arguments", "{}"
                )
                if response.tool_calls
                else "{}"
            )
            follow_up_messages = oai_messages + [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": tool_call_id,
                            "type": "function",
                            "function": {
                                "name": "set_notes",
                                "arguments": raw_args
                                if isinstance(raw_args, str)
                                else json.dumps(raw_args),
                            },
                        }
                    ],
                },
                {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": "Notes updated.",
                },
            ]

            # Follow-up call WITHOUT tools — we don't want the model to
            # re-call set_notes in the acknowledgement turn.
            try:
                follow_up = await _call_openai(follow_up_messages)
            except Exception:  # noqa: BLE001
                logger.exception(
                    "shared-state-read-write: follow-up _call_openai failed"
                )
                follow_up = None
            if follow_up is not None:
                content = getattr(follow_up, "content", None) or ""
                if content:
                    msg_id = str(uuid.uuid4())
                    yield _sse_line(
                        TextMessageStartEvent(
                            type=EventType.TEXT_MESSAGE_START,
                            message_id=msg_id,
                        )
                    )
                    yield _sse_line(
                        TextMessageContentEvent(
                            type=EventType.TEXT_MESSAGE_CONTENT,
                            message_id=msg_id,
                            delta=content,
                        )
                    )
                    yield _sse_line(
                        TextMessageEndEvent(
                            type=EventType.TEXT_MESSAGE_END,
                            message_id=msg_id,
                        )
                    )
        else:
            content = getattr(response, "content", None) or ""
            if content:
                msg_id = str(uuid.uuid4())
                yield _sse_line(
                    TextMessageStartEvent(
                        type=EventType.TEXT_MESSAGE_START, message_id=msg_id
                    )
                )
                yield _sse_line(
                    TextMessageContentEvent(
                        type=EventType.TEXT_MESSAGE_CONTENT,
                        message_id=msg_id,
                        delta=content,
                    )
                )
                yield _sse_line(
                    TextMessageEndEvent(
                        type=EventType.TEXT_MESSAGE_END, message_id=msg_id
                    )
                )

        yield _sse_line(
            RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id,
            )
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
