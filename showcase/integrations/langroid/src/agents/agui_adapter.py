"""
AG-UI SSE Adapter for Langroid

Implements the AG-UI protocol over SSE, calling the OpenAI chat completions
API directly (via ``openai.AsyncOpenAI``) and translating the response into
the AG-UI event stream that CopilotKit expects. Tool schemas are derived
from Langroid ToolMessage subclasses defined in ``agents.agent``.

The adapter preserves structured multi-turn messages (including ``role:
"tool"`` with ``tool_call_id``) so that aimock fixture matchers can match
follow-up requests by toolCallId — enabling the frontend tool execution
loop (e.g. gen-ui-headless: show_card → follow-up narration).

AG-UI event types used:
  - RUN_STARTED / RUN_FINISHED
  - TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT / TEXT_MESSAGE_END
  - TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
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
    ToolCallResultEvent,
    RunAgentInput,
)
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse

from agents.agent import (
    build_agent_config_system_prompt,
    extract_agent_config_properties,
    ALL_TOOLS,
    FRONTEND_TOOL_NAMES,
    SYSTEM_PROMPT,
)

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
    raise RuntimeError(f"Duplicate tool request names in ALL_TOOLS: {dupes!r}")

# Freeze the lookup table. Post-import mutation would silently corrupt
# dispatch (e.g. a test monkeypatching one entry could shadow a real
# tool class at runtime). ``MappingProxyType`` makes the map read-only
# at the interpreter level — attempts to assign raise ``TypeError``.
_TOOL_BY_NAME: Mapping[str, type[ToolMessage]] = MappingProxyType(_tool_by_name_mutable)


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
            {"error": (f"Tool {tool_name} failed: {exc.__class__.__name__}")}
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
            {"error": (f"Tool {tool_name} failed: {exc.__class__.__name__}")}
        )
    return await asyncio.to_thread(_execute_backend_tool, tool_instance, tool_name)


def _agui_messages_to_openai(
    messages: list,
    system_prompt: str,
) -> list[dict[str, Any]]:
    """Convert AG-UI messages to OpenAI chat completion format.

    AG-UI messages arrive as typed Pydantic models (UserMessage,
    AssistantMessage, ToolMessage, etc.) with fields like ``tool_calls``
    and ``tool_call_id``. The previous flattening logic (``"role: content"``)
    lost these structured fields, preventing aimock's ``toolCallId`` fixture
    matcher from finding follow-up tool results.

    This function preserves the full message structure so the OpenAI API
    (or aimock standing in for it) receives proper multi-turn conversations
    including ``role: "tool"`` messages with ``tool_call_id``.
    """
    oai_msgs: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
    ]

    for msg in messages:
        role = getattr(msg, "role", None)
        if not isinstance(role, str):
            if isinstance(msg, dict):
                role = msg.get("role")
            if not isinstance(role, str):
                continue

        if role == "tool":
            # AG-UI ToolMessage → OpenAI tool result message.
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
            # AG-UI AssistantMessage may carry tool_calls.
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
                    # OpenAI requires content to be null (not missing)
                    # when tool_calls are present and there's no text.
                    if "content" not in oai_msg:
                        oai_msg["content"] = None
            else:
                # Plain assistant text — ensure content is present.
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

        # Unknown role — skip with a debug log.
        logger.debug(
            "Skipping message with unrecognized role %r in _agui_messages_to_openai",
            role,
        )

    return oai_msgs


def _build_openai_tools() -> list[dict[str, Any]]:
    """Build OpenAI-format tool definitions from ALL_TOOLS.

    Each Langroid ToolMessage subclass declares ``request`` (tool name),
    ``purpose`` (description), and typed fields (parameters). We convert
    these into the ``{"type": "function", "function": {...}}`` shape that
    the OpenAI chat completions API expects.
    """
    tools: list[dict[str, Any]] = []
    for tool_cls in ALL_TOOLS:
        name = tool_cls.default_value("request")
        purpose = (
            tool_cls.default_value("purpose") if hasattr(tool_cls, "purpose") else ""
        )

        # Build parameters from model fields, excluding metadata.
        properties: dict[str, Any] = {}
        required: list[str] = []
        for field_name, field_info in tool_cls.model_fields.items():
            if field_name in ("request", "purpose", "result"):
                continue
            # Simple type mapping — sufficient for aimock fixture matching.
            annotation = field_info.annotation
            if annotation is str or (
                hasattr(annotation, "__origin__") is False and annotation is str
            ):
                prop = {"type": "string"}
            elif annotation is int:
                prop = {"type": "integer"}
            elif annotation is float:
                prop = {"type": "number"}
            elif annotation is bool:
                prop = {"type": "boolean"}
            elif annotation is list or (
                hasattr(annotation, "__origin__")
                and getattr(annotation, "__origin__", None) is list
            ):
                prop = {"type": "array"}
            else:
                prop = {"type": "string"}

            desc = ""
            if hasattr(field_info, "description") and field_info.description:
                desc = field_info.description
            elif hasattr(field_info, "metadata"):
                for m in field_info.metadata:
                    if isinstance(m, str):
                        desc = m
                        break
            if desc:
                prop["description"] = desc

            properties[field_name] = prop
            if field_info.default is pydantic.fields.PydanticUndefined:
                required.append(field_name)

        func_def: dict[str, Any] = {
            "name": name,
            "description": purpose or f"Tool: {name}",
            "parameters": {
                "type": "object",
                "properties": properties,
            },
        }
        if required:
            func_def["parameters"]["required"] = required

        tools.append({"type": "function", "function": func_def})

    return tools


# Cache tool definitions — they don't change at runtime.
_OPENAI_TOOLS: list[dict[str, Any]] | None = None


def _get_openai_tools() -> list[dict[str, Any]]:
    """Return cached OpenAI tool definitions."""
    global _OPENAI_TOOLS
    if _OPENAI_TOOLS is None:
        _OPENAI_TOOLS = _build_openai_tools()
    return _OPENAI_TOOLS


async def _call_openai(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: str,
) -> Any:
    """Call the OpenAI chat completions API directly.

    Uses ``openai.AsyncOpenAI()`` which reads ``OPENAI_API_KEY`` and
    ``OPENAI_BASE_URL`` from the environment (aimock sets the base URL
    in the showcase). Returns the first choice's message object.
    """
    client = openai.AsyncOpenAI()
    response = await client.chat.completions.create(
        model=model,
        messages=messages,
        tools=tools if tools else openai.NOT_GIVEN,
    )
    return response.choices[0].message


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

    # Agent-config demo — <CopilotKit properties={tone, expertise,
    # responseLength}> arrives as forwarded_props.config.configurable.properties
    # (the dedicated Next.js route at copilotkit-agent-config repacks flat
    # provider keys into that canonical shape before POSTing here). When
    # those properties are present, steer the system prompt for this run
    # only. For every other demo ``forwarded_props`` is empty / missing
    # the keys and ``extract_agent_config_properties`` returns None, so
    # behavior is unchanged.
    agent_config_props = extract_agent_config_properties(run_input.forwarded_props)
    system_prompt = SYSTEM_PROMPT
    if agent_config_props is not None:
        system_prompt = build_agent_config_system_prompt(
            tone=agent_config_props.get("tone"),
            expertise=agent_config_props.get("expertise"),
            response_length=agent_config_props.get("responseLength"),
        )

    # Build proper OpenAI-format messages from the AG-UI message history.
    # The previous approach flattened all messages into a single "role:
    # content" string, which lost structured fields like tool_call_id and
    # tool_calls. This prevented aimock's toolCallId fixture matcher from
    # finding follow-up tool results, breaking the gen-ui-headless flow
    # (frontend tool → follow-up narration never arrived).
    oai_messages = _agui_messages_to_openai(run_input.messages or [], system_prompt)
    model = os.getenv("LANGROID_MODEL", "gpt-4.1")
    oai_tools = _get_openai_tools()

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
                _sse_line(
                    TextMessageStartEvent(
                        type=EventType.TEXT_MESSAGE_START,
                        message_id=msg_id,
                    )
                ),
                _sse_line(
                    TextMessageContentEvent(
                        type=EventType.TEXT_MESSAGE_CONTENT,
                        message_id=msg_id,
                        delta=text,
                    )
                ),
                _sse_line(
                    TextMessageEndEvent(
                        type=EventType.TEXT_MESSAGE_END,
                        message_id=msg_id,
                    )
                ),
            ]

        yield _sse_line(
            RunStartedEvent(
                type=EventType.RUN_STARTED,
                thread_id=thread_id,
                run_id=run_id,
            )
        )

        # Call the LLM directly via the OpenAI client. This replaced
        # langroid's ``agent.llm_response_async(flattened_string)`` to
        # preserve structured multi-turn messages (tool_calls,
        # tool_call_id) that aimock's fixture matchers depend on for
        # follow-up requests (e.g. gen-ui-headless second-leg narration).
        #
        # Any failure here happens *after* RUN_STARTED was emitted, so
        # the frontend is already waiting for a RUN_FINISHED. Emit a
        # sanitized TEXT_MESSAGE triple and then RUN_FINISHED to close
        # out the run cleanly. The full traceback is preserved
        # server-side via ``logger.exception``.
        try:
            response = await _call_openai(oai_messages, oai_tools, model)
        except (
            openai.APIError,
            httpx.HTTPError,
            asyncio.TimeoutError,
        ) as exc:
            logger.exception("_call_openai failed mid-stream")
            err_payload = json.dumps(
                {"error": f"Agent run failed: {exc.__class__.__name__}"}
            )
            for line in emit_text_block(str(uuid.uuid4()), err_payload):
                yield line
            yield _sse_line(
                RunFinishedEvent(
                    type=EventType.RUN_FINISHED,
                    thread_id=thread_id,
                    run_id=run_id,
                )
            )
            return

        if response is None:
            # Empty response — just finish
            yield _sse_line(
                RunFinishedEvent(
                    type=EventType.RUN_FINISHED,
                    thread_id=thread_id,
                    run_id=run_id,
                )
            )
            return

        # ``response`` is an OpenAI ChatCompletionMessage. ``.content``
        # is the text; ``.tool_calls`` carries structured tool calls.
        content = getattr(response, "content", None) or ""
        oai_tool_calls = getattr(response, "tool_calls", None) or []

        if oai_tool_calls:
            # Emit synthesized tool-call events for each OAI tool call.
            # ``_parse_tool_args`` returns a ``ParsedArgs`` with
            # ``status`` in ``{"ok", "empty", "malformed"}``. We only
            # emit when ``parsed.usable`` (i.e. ``status == "ok"``) —
            # otherwise we SKIP the tool call entirely rather than
            # emitting a call with ``{}`` (which renders a meaningless
            # UI card). The warning already fired inside
            # ``_parse_tool_args`` on the malformed path.
            calls_to_emit = []
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

            if calls_to_emit:
                # Emit a TEXT_MESSAGE_START to create a parent assistant
                # message that the tool calls attach to.  Without this,
                # the AG-UI client still synthesizes a message per tool
                # call, but the Runtime's middleware SSE parser (used by
                # open-gen-ui and other middleware) cannot associate tool
                # calls with a parent message — they are silently dropped.
                # Emitting the triple (START → tool calls → END) mirrors
                # what LangGraph and google-adk adapters produce.
                tc_parent_id = str(uuid.uuid4())
                yield _sse_line(
                    TextMessageStartEvent(
                        type=EventType.TEXT_MESSAGE_START,
                        message_id=tc_parent_id,
                    )
                )

                for call_id, tool_name, tool_args in calls_to_emit:
                    yield _sse_line(
                        ToolCallStartEvent(
                            type=EventType.TOOL_CALL_START,
                            tool_call_id=call_id,
                            tool_call_name=tool_name,
                            parent_message_id=tc_parent_id,
                        )
                    )

                    yield _sse_line(
                        ToolCallArgsEvent(
                            type=EventType.TOOL_CALL_ARGS,
                            tool_call_id=call_id,
                            delta=json.dumps(tool_args),
                        )
                    )

                    yield _sse_line(
                        ToolCallEndEvent(
                            type=EventType.TOOL_CALL_END,
                            tool_call_id=call_id,
                        )
                    )

                    # For backend tools, execute and emit the result as a
                    # ToolCallResultEvent so the CopilotKit runtime can
                    # transition the useRenderTool status from "executing"
                    # to "complete". Without this event the frontend card
                    # stays stuck in a loading state.
                    if tool_name not in FRONTEND_TOOL_NAMES:
                        tool_cls = _TOOL_BY_NAME.get(tool_name)
                        result: str | None = None
                        if tool_cls is not None:
                            result = await _run_backend_tool(
                                tool_cls, tool_name, tool_args
                            )

                        if result:
                            yield _sse_line(
                                ToolCallResultEvent(
                                    type=EventType.TOOL_CALL_RESULT,
                                    tool_call_id=call_id,
                                    message_id=str(uuid.uuid4()),
                                    content=result,
                                )
                            )

                # Close the parent message that wraps the tool calls.
                yield _sse_line(
                    TextMessageEndEvent(
                        type=EventType.TEXT_MESSAGE_END,
                        message_id=tc_parent_id,
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

        # Check if the response contains a tool call parsed from content
        tool_msg = _try_parse_tool(content)

        if tool_msg is not None:
            tool_name = (
                tool_msg.default_value("request")
                if hasattr(tool_msg, "default_value")
                else getattr(tool_msg, "request", "unknown")
            )
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

            # Emit a parent TEXT_MESSAGE that wraps the tool call, same
            # as the oai_tool_calls path above. Without this, the
            # Runtime middleware-sse-parser cannot attach the tool call
            # to a parent message and silently drops it.
            ct_parent_id = str(uuid.uuid4())
            yield _sse_line(
                TextMessageStartEvent(
                    type=EventType.TEXT_MESSAGE_START,
                    message_id=ct_parent_id,
                )
            )

            yield _sse_line(
                ToolCallStartEvent(
                    type=EventType.TOOL_CALL_START,
                    tool_call_id=tool_call_id,
                    tool_call_name=tool_name,
                    parent_message_id=ct_parent_id,
                )
            )

            yield _sse_line(
                ToolCallArgsEvent(
                    type=EventType.TOOL_CALL_ARGS,
                    tool_call_id=tool_call_id,
                    delta=json.dumps(tool_args),
                )
            )

            yield _sse_line(
                ToolCallEndEvent(
                    type=EventType.TOOL_CALL_END,
                    tool_call_id=tool_call_id,
                )
            )

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
                    err_payload = json.dumps(
                        {
                            "error": (
                                f"Tool {tool_name} failed: {exc.__class__.__name__}"
                            )
                        }
                    )
                    yield _sse_line(
                        ToolCallResultEvent(
                            type=EventType.TOOL_CALL_RESULT,
                            tool_call_id=tool_call_id,
                            message_id=str(uuid.uuid4()),
                            content=err_payload,
                        )
                    )
                    yield _sse_line(
                        TextMessageEndEvent(
                            type=EventType.TEXT_MESSAGE_END,
                            message_id=ct_parent_id,
                        )
                    )
                    yield _sse_line(
                        RunFinishedEvent(
                            type=EventType.RUN_FINISHED,
                            thread_id=thread_id,
                            run_id=run_id,
                        )
                    )
                    raise
                if result:
                    yield _sse_line(
                        ToolCallResultEvent(
                            type=EventType.TOOL_CALL_RESULT,
                            tool_call_id=tool_call_id,
                            message_id=str(uuid.uuid4()),
                            content=result,
                        )
                    )

            # Close the parent message that wraps the tool call.
            yield _sse_line(
                TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END,
                    message_id=ct_parent_id,
                )
            )
        else:
            # Plain text response — stream it. emit_text_block handles the
            # empty-delta guard (AG-UI requires non-empty deltas, e.g. a
            # pure tool-call turn where content was stripped to "").
            for line in emit_text_block(message_id, content):
                yield line

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


def _try_parse_tool(content: str) -> ToolMessage | None:
    """Try to parse a Langroid ToolMessage from the LLM response content.

    The OpenAI response's ``content`` field sometimes contains a JSON
    tool envelope (Langroid convention: ``{"request": ..., ...}``) or
    an OpenAI function-call shape (``{"name": ..., "arguments": ...}``).
    This fallback path catches those cases when the response didn't use
    the structured ``tool_calls`` field.

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
        args = data.get("arguments") or (data.get("function", {}) or {}).get(
            "arguments", {}
        )
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
