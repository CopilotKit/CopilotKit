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
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, AsyncGenerator, Literal, Mapping

import httpx
import openai
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
from fastapi.responses import JSONResponse, StreamingResponse

from .agent import (
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
_tool_by_name_mutable: dict[str, type[ToolMessage]] = {
    cls.default_value("request"): cls for cls in ALL_TOOLS
}
if len(_tool_by_name_mutable) != len(ALL_TOOLS):
    # Collisions are a programmer error — don't try to recover.
    # Build a name -> [qualified class identities] map so the error
    # names the *actual* classes involved. Seeing a bare string like
    # ``"get_weather"`` in the stacktrace forces the developer to grep
    # the whole repo; emitting ``module.Class`` pairs points them
    # directly at the two definitions that need to be reconciled.
    by_name: dict[str, list[str]] = {}
    for cls in ALL_TOOLS:
        name = cls.default_value("request")
        ident = f"{cls.__module__}.{cls.__qualname__}"
        by_name.setdefault(name, []).append(ident)
    dupes = {name: idents for name, idents in by_name.items() if len(idents) > 1}
    raise RuntimeError(
        f"Duplicate tool request names in ALL_TOOLS: {dupes!r}"
    )

# Freeze the lookup table. Post-import mutation would silently corrupt
# dispatch (e.g. a test monkeypatching one entry could shadow a real
# tool class at runtime). ``MappingProxyType`` makes the map read-only
# at the interpreter level — attempts to assign raise ``TypeError``.
_TOOL_BY_NAME: Mapping[str, type[ToolMessage]] = MappingProxyType(
    _tool_by_name_mutable
)

def _sse_line(event: Any) -> str:
    """Format an AG-UI event as an SSE data line (camelCase keys per AG-UI protocol)."""
    if hasattr(event, "model_dump"):
        data = event.model_dump(by_alias=True, exclude_none=True)
    else:
        data = dict(event)
    return f"data: {json.dumps(data)}\n\n"

@dataclass(frozen=True)
class ParsedArgs:
    """Discriminated result from :func:`_parse_tool_args`.

    Using a small dataclass with an explicit ``status`` eliminates the
    three-way overloading of a bare ``dict | None`` return (where the
    caller had to remember which of ``{}`` / ``None`` / ``dict`` meant
    "empty", "malformed", or "ok"). Each call site now pattern-matches
    on ``status`` explicitly.

    * ``status == "ok"``: ``args`` is a fresh dict safe to mutate.
    * ``status == "empty"``: ``args`` is ``{}``. Kept for completeness;
      callers currently coerce this to DEGRADED (see below).
    * ``status == "malformed"``: parsing was attempted and failed.
      ``args`` is ``{}`` but callers MUST treat this as DEGRADED and
      skip emitting the tool call — firing a tool with empty args
      produces a meaningless UI card.
    """

    args: dict
    status: Literal["ok", "empty", "malformed"]

    @property
    def usable(self) -> bool:
        """True iff the caller should actually fire the tool call."""
        return self.status == "ok"

def _parse_tool_args(raw_args: Any) -> ParsedArgs:
    """Coerce tool-call arguments into a :class:`ParsedArgs`.

    OpenAI-style arguments arrive as a JSON string; Langroid sometimes
    passes a pre-parsed dict. On ``"ok"`` the ``args`` dict is a fresh
    copy so callers are free to mutate without affecting the original.

    Empty-string input (legacy ``function_call`` path) is normalized to
    ``"malformed"`` — firing a tool with no arguments produces a
    meaningless UI card, so we skip it the same way we skip unparseable
    JSON.
    """
    if isinstance(raw_args, dict):
        # Shallow copy so callers may mutate safely.
        return ParsedArgs(args=dict(raw_args), status="ok")
    if isinstance(raw_args, (str, bytes)):
        if not raw_args:
            # Empty string/bytes — treat as DEGRADED, not "ok with {}".
            # This is consistent with the oai-path rationale: no args
            # means the UI card has nothing to render.
            return ParsedArgs(args={}, status="malformed")
        try:
            parsed = json.loads(raw_args)
        except json.JSONDecodeError as exc:
            # ``raw_args`` may be bytes here; ``repr`` handles both.
            truncated = raw_args[:200]
            logger.warning(
                "Failed to JSON-decode tool-call arguments (%s): %r", exc, truncated
            )
            return ParsedArgs(args={}, status="malformed")
        if isinstance(parsed, dict):
            return ParsedArgs(args=parsed, status="ok")
        logger.warning(
            "Tool-call arguments parsed to non-dict (%s): %r",
            type(parsed).__name__,
            str(parsed)[:200],
        )
        return ParsedArgs(args={}, status="malformed")
    # Unknown non-dict / non-str / non-bytes type — no parse attempted.
    # Preserved as ``"empty"`` (not a parse failure) so callers can
    # distinguish "we tried and failed" from "nothing to try".
    return ParsedArgs(args={}, status="empty")

def _execute_backend_tool(
    tool_instance: ToolMessage,
    tool_name: str,
) -> str:
    """Run a backend tool's ``.handle()`` in a worker thread and return
    its result as a string, sanitizing any exception into a user-safe
    JSON payload.

    Contract (both the oai_tool_calls path and the content-JSON path
    share this so the SSE stream behaves identically):

      * On success, returns ``.handle()``'s return value unchanged.
        (Callers wrap it in a ``TEXT_MESSAGE_*`` triple.)
      * On failure, logs the full traceback server-side via
        ``logger.exception`` and returns a JSON string of the form
        ``{"error": "Tool {name} failed: {ClassName}"}``. The
        exception message itself (``str(exc)``) is intentionally
        OMITTED — it commonly embeds file paths, connection strings,
        secrets, or stack frames. Only the tool name and the
        exception class name leak to the caller.

    Exception scope: narrowed to ``(pydantic.ValidationError, ValueError)``
    which together cover the realistic data-shape failures we see from
    backend tools (bad payloads, schema drift, arithmetic/format
    errors). Broader exceptions (``RuntimeError``, ``KeyError``,
    ``TypeError``, arbitrary third-party errors) are NOT sanitized —
    they propagate up and are logged as unexpected by the outer
    framework, which is what we want for real bugs / config drift.
    """
    try:
        return tool_instance.handle()
    except (pydantic.ValidationError, ValueError) as exc:
        # Full traceback server-side (``logger.exception`` attaches
        # ``exc_info`` automatically). User-facing payload is sanitized:
        # only the tool name and the exception class name leak — never
        # ``str(exc)`` (which commonly embeds file paths, connection
        # strings, secrets, or stack frames).
        logger.exception("Tool %s execution failed", tool_name)
        return json.dumps(
            {
                "error": (
                    f"Tool {tool_name} failed: {exc.__class__.__name__}"
                )
            }
        )

async def _run_backend_tool(
    tool_cls: type[ToolMessage],
    tool_name: str,
    tool_args: dict,
) -> str | None:
    """Instantiate a backend tool and run it off-thread with sanitized
    errors. Returns ``None`` only when construction failed before a
    runtime handler could even be invoked (in which case a sanitized
    error payload is returned instead — never ``None`` from a live
    call).
    """
    try:
        tool_instance = tool_cls(**tool_args)
    except (pydantic.ValidationError, ValueError, TypeError) as exc:
        # Instantiation failures are almost always bad/missing fields
        # from the LLM's tool arguments — treat identically to runtime
        # sanitized errors so the UI shows a clear, non-leaky failure.
        logger.exception("Tool %s construction failed", tool_name)
        return json.dumps(
            {
                "error": (
                    f"Tool {tool_name} failed: {exc.__class__.__name__}"
                )
            }
        )
    return await asyncio.to_thread(
        _execute_backend_tool, tool_instance, tool_name
    )

async def handle_run(request: Request) -> StreamingResponse:
    """Handle an AG-UI /run endpoint — parse input, run agent, stream events."""
    # Parse request body defensively. A malformed body (bad JSON, missing
    # required fields, wrong types) previously propagated up as a raw
    # FastAPI 422/500 with no correlation id — hard to match back to a
    # client-side failure. Generate a stable ``error_id`` and return a
    # structured JSON body so the caller gets something actionable.
    error_id = str(uuid.uuid4())
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError) as exc:
        logger.exception("Failed to parse request body (error_id=%s)", error_id)
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
    except (pydantic.ValidationError, TypeError, ValueError) as exc:
        logger.exception(
            "Failed to coerce body into RunAgentInput (error_id=%s)", error_id
        )
        return JSONResponse(
            {
                "error": "Invalid RunAgentInput payload",
                "errorId": error_id,
                "class": exc.__class__.__name__,
            },
            status_code=422,
        )

    agent = create_agent()

    # Build conversation history from all messages so multi-turn works.
    # Each ``msg.role`` / ``msg.content`` must be a string — silently
    # f-stringifying ``None`` or a complex object produces garbage like
    # "None: {'foo': 'bar'}" that the LLM then tries to interpret as
    # conversation. Drop non-string entries and log a warning so the
    # shape drift is at least visible in ops logs.
    conversation_parts: list[str] = []
    if run_input.messages:
        for msg in run_input.messages:
            if hasattr(msg, "role") and hasattr(msg, "content"):
                role = getattr(msg, "role", None)
                content = getattr(msg, "content", None)
                if not isinstance(role, str) or not isinstance(content, str):
                    logger.warning(
                        "Skipping message with non-string role/content "
                        "(role=%s, content=%s)",
                        type(role).__name__,
                        type(content).__name__,
                    )
                    continue
                conversation_parts.append(f"{role}: {content}")
            elif isinstance(msg, dict):
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if not isinstance(role, str) or not isinstance(content, str):
                    logger.warning(
                        "Skipping dict message with non-string role/content "
                        "(role=%s, content=%s)",
                        type(role).__name__,
                        type(content).__name__,
                    )
                    continue
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

        # Run the Langroid agent. Any failure here happens *after*
        # RUN_STARTED was emitted, so the frontend is already waiting
        # for a RUN_FINISHED. If we let the exception escape here, the
        # generator dies mid-stream and the UI hangs forever. Emit a
        # sanitized TEXT_MESSAGE triple (so the user sees *something*)
        # and then RUN_FINISHED to close out the run cleanly. The
        # full traceback is preserved server-side via
        # ``logger.exception``.
        #
        # Exception scope: narrowed to the set of runtime failures we
        # actually expect from ``agent.llm_response_async`` — upstream
        # LLM API errors (``openai.APIError``), transport failures
        # (``httpx.HTTPError``), timeouts, and schema drift
        # (``pydantic.ValidationError``). Programmer bugs
        # (``AttributeError``, ``NameError``, ``TypeError``) are NOT
        # sanitized here — they propagate up and surface as real
        # tracebacks. Any uncaught mid-stream exception is still
        # handled one level up by the route boundary's try/except, but
        # with a less operator-friendly "unknown error" message —
        # that's the right trade: a narrower list keeps legitimate
        # bugs visible instead of masking them as "Agent run failed:
        # AttributeError".
        try:
            response = await agent.llm_response_async(user_message)
        except (
            openai.APIError,
            httpx.HTTPError,
            asyncio.TimeoutError,
            pydantic.ValidationError,
        ) as exc:
            logger.exception("agent.llm_response_async failed mid-stream")
            err_payload = json.dumps({
                "error": f"Agent run failed: {exc.__class__.__name__}"
            })
            for line in emit_text_block(str(uuid.uuid4()), err_payload):
                yield line
            yield _sse_line(RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id,
            ))
            return

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
            # ``_parse_tool_args`` returns a ``ParsedArgs`` with
            # ``status`` in ``{"ok", "empty", "malformed"}``. We only
            # emit when ``parsed.usable`` (i.e. ``status == "ok"``) —
            # otherwise we SKIP the tool call entirely rather than
            # emitting a call with ``{}`` (which renders a meaningless
            # UI card). The warning already fired inside
            # ``_parse_tool_args`` on the malformed path.
            calls_to_emit = []
            if oai_tool_calls:
                for tc in oai_tool_calls:
                    fn = getattr(tc, "function", None)
                    name = getattr(fn, "name", None) if fn is not None else None
                    raw_args = getattr(fn, "arguments", {}) if fn is not None else {}
                    parsed = _parse_tool_args(raw_args)
                    call_id = getattr(tc, "id", None) or str(uuid.uuid4())
                    if name and parsed.usable:
                        calls_to_emit.append((call_id, name, parsed.args))
                    elif name:
                        logger.warning(
                            "Skipping tool call %s: arguments could not be parsed (status=%s)",
                            name,
                            parsed.status,
                        )
            elif function_call is not None:
                # Legacy function_call shape: single call. Empty-string
                # ``arguments`` is normalized to ``"malformed"`` by
                # ``_parse_tool_args`` so this path behaves identically
                # to a malformed-JSON oai call (skip + warn).
                name = getattr(function_call, "name", None)
                raw_args = getattr(function_call, "arguments", "") or ""
                parsed = _parse_tool_args(raw_args)
                if name and parsed.usable:
                    calls_to_emit.append((str(uuid.uuid4()), name, parsed.args))
                elif name:
                    logger.warning(
                        "Skipping tool call %s: arguments could not be parsed (status=%s)",
                        name,
                        parsed.status,
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
                # Both the oai-path and the content-JSON path below fan
                # out through ``_run_backend_tool`` so sanitization and
                # off-thread execution behave identically.
                if tool_name not in FRONTEND_TOOL_NAMES:
                    tool_cls = _TOOL_BY_NAME.get(tool_name)
                    result: str | None = None
                    if tool_cls is not None:
                        result = await _run_backend_tool(
                            tool_cls, tool_name, tool_args
                        )

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

            # If it's a backend tool, execute it and stream the result
            # as text. We already have the instantiated ``tool_msg`` (it
            # came from ``_try_parse_tool``), so bypass the construction
            # step and go straight through ``_execute_backend_tool`` —
            # shares the sanitization contract with the oai path above.
            #
            # Wrap the ``to_thread`` call itself in a broad try/except:
            # ``_execute_backend_tool`` already sanitizes narrowed
            # data-errors, but the scheduler call (thread-pool full,
            # cancellation, loop shutdown) can raise *outside* that
            # contract. Letting such an exception escape aborts the SSE
            # generator after events have already been emitted, which
            # hangs the UI. Emit a sanitized error + RUN_FINISHED and
            # then re-raise so the framework still sees the real bug.
            if tool_name not in FRONTEND_TOOL_NAMES:
                try:
                    result = await asyncio.to_thread(
                        _execute_backend_tool, tool_msg, tool_name
                    )
                except Exception as exc:
                    logger.exception(
                        "asyncio.to_thread failed executing backend tool %s",
                        tool_name,
                    )
                    err_payload = json.dumps({
                        "error": (
                            f"Tool {tool_name} failed: "
                            f"{exc.__class__.__name__}"
                        )
                    })
                    for line in emit_text_block(
                        str(uuid.uuid4()), err_payload
                    ):
                        yield line
                    yield _sse_line(RunFinishedEvent(
                        type=EventType.RUN_FINISHED,
                        thread_id=thread_id,
                        run_id=run_id,
                    ))
                    raise
                if result:
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

    Langroid's `agent.llm_response_async(...)` returns a `ChatDocument`,
    not a `ToolMessage`, so the previous isinstance-based path was
    effectively dead code. We rely on the JSON fallback, which matches
    both the Langroid tool envelope (`{"request": ..., ...}`) and the
    OpenAI function-call shape (`{"name": ..., "arguments": ...}`).

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
    # Guard: ``json.loads`` only accepts ``str``/``bytes``/``bytearray``.
    # Anything else here would be a programmer bug (we promised callers
    # the common "plain text" path is silent, so we shouldn't lump that
    # kind of type bug into the silent JSONDecodeError bucket).
    if not isinstance(content, (str, bytes, bytearray)):
        logger.warning(
            "_try_parse_tool called with non-str/bytes content (%s); "
            "skipping tool parse",
            type(content).__name__,
        )
        return None

    try:
        data = json.loads(content)
    except json.JSONDecodeError:
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
                ) as exc:
                    # NOTE: ``PydanticUserError`` is intentionally NOT
                    # caught here. It signals a malformed model *class
                    # definition* (programmer bug in ``ALL_TOOLS``), not
                    # a runtime data error, and should surface loudly
                    # at startup rather than be silenced as "bad input".
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
            if isinstance(args, (str, bytes, bytearray)):
                # Mirror ``_parse_tool_args``: real OpenAI/httpx stacks can
                # deliver ``arguments`` as bytes on the wire; a narrow
                # ``isinstance(args, str)`` guard would fall through to
                # ``tool_cls(**args)`` with a raw bytes object and blow up
                # with a TypeError that the outer handler then silently
                # swallows. Accept the same (str, bytes, bytearray) trio
                # that ``json.loads`` itself accepts.
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
                    ) as exc:
                        # See note above: PydanticUserError is a
                        # class-definition bug, not a runtime data
                        # error — do not swallow it here.
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
