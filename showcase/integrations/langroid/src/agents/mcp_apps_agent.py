"""MCP Apps demo backend (Langroid).

The CopilotKit runtime is wired with ``mcpApps: { servers: [...] }`` (see
``src/app/api/copilotkit-mcp-apps/route.ts``); the runtime auto-applies
the MCP Apps middleware, which injects the remote MCP server's tools
into the AG-UI run input at request time and emits the activity events
that CopilotKit's built-in ``MCPAppsActivityRenderer`` renders inline
in the chat as a sandboxed iframe.

Because the tool catalog is supplied by the runtime per-request (in
``RunAgentInput.tools``), the Python agent for this demo does **not**
declare any langroid ``ToolMessage`` subclasses. We forward the inbound
tool list straight to the OpenAI chat completions API and surface
whatever tool calls the model emits — the runtime middleware on the
TypeScript side picks them up, fetches the MCP UI resource, and emits
the activity events that render the iframe.

The handler is wired up by ``agent_server.py`` at ``POST /mcp-apps``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Any, AsyncGenerator

import httpx
import openai
import pydantic
from ag_ui.core import (
    EventType,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse

logger = logging.getLogger(__name__)


# Speed-biased system prompt — mirrors the langgraph-python MCP Apps
# agent. We want one fast tool call that produces a correct-enough
# diagram; we are not optimizing for polish.
_SYSTEM_PROMPT = """\
You draw simple diagrams in Excalidraw via the MCP tool.

SPEED MATTERS. Produce a correct-enough diagram fast; do not optimize
for polish. Target: one tool call, done in seconds.

When the user asks for a diagram:
1. Call `create_view` ONCE with 3-5 elements total: shapes + arrows +
   an optional title text.
2. Use straightforward shapes (rectangle, ellipse, diamond) with plain
   `label` fields (`{"text": "...", "fontSize": 18}`) on them.
3. Connect with arrows. Endpoints can be element centers or simple
   coordinates — you don't need edge anchors / fixedPoint bindings.
4. Include ONE `cameraUpdate` at the END of the elements array that
   frames the whole diagram. Use an approved 4:3 size (600x450 or
   800x600). No opening camera needed.
5. Reply with ONE short sentence describing what you drew.

Every element needs a unique string `id` (e.g. "b1", "a1", "title").
Standard sizes: rectangles 160x70, ellipses/diamonds 120x80, 40-80px
gap between shapes.

Do NOT:
- Call `read_me`. You already know the basic shape API.
- Make multiple `create_view` calls.
- Iterate or refine. Ship on the first shot.
- Add decorative colors / fills / zone backgrounds unless the user
  explicitly asks for them.
- Add labels on arrows unless crucial.
"""


# ---------------------------------------------------------------------------
# AG-UI message → OpenAI message conversion (compact mirror of agui_adapter)
# ---------------------------------------------------------------------------


def _agui_messages_to_openai(messages: Any, system_prompt: str) -> list[dict[str, Any]]:
    """Translate AG-UI typed messages into OpenAI chat completion shape.

    Mirrors the conversion in ``agents.agui_adapter`` but is duplicated
    locally to keep this module's dependency surface small (the unified
    adapter pulls in ``ALL_TOOLS`` and other unrelated machinery).
    """
    out: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    if not messages:
        return out
    for msg in messages:
        role = (
            getattr(msg, "role", None) if not isinstance(msg, dict) else msg.get("role")
        )
        if not isinstance(role, str):
            continue
        if role == "tool":
            tool_call_id = (
                getattr(msg, "tool_call_id", None)
                if not isinstance(msg, dict)
                else msg.get("tool_call_id")
            )
            content = (
                getattr(msg, "content", "")
                if not isinstance(msg, dict)
                else msg.get("content", "")
            ) or ""
            if tool_call_id:
                out.append(
                    {
                        "role": "tool",
                        "tool_call_id": str(tool_call_id),
                        "content": str(content),
                    }
                )
            continue
        if role == "assistant":
            content = (
                getattr(msg, "content", None)
                if not isinstance(msg, dict)
                else msg.get("content")
            )
            tool_calls_raw = (
                getattr(msg, "tool_calls", None)
                if not isinstance(msg, dict)
                else msg.get("tool_calls")
            )
            entry: dict[str, Any] = {"role": "assistant"}
            if content:
                entry["content"] = str(content)
            if tool_calls_raw:
                tcs: list[dict[str, Any]] = []
                for tc in tool_calls_raw:
                    tc_id = getattr(tc, "id", None)
                    fn = getattr(tc, "function", None)
                    if fn is None and isinstance(tc, dict):
                        fn_name = (tc.get("function") or {}).get("name", "")
                        fn_args = (tc.get("function") or {}).get("arguments", "")
                        tc_id = tc_id or tc.get("id", "")
                    else:
                        fn_name = getattr(fn, "name", "") if fn else ""
                        fn_args = getattr(fn, "arguments", "") if fn else ""
                    if tc_id and fn_name:
                        tcs.append(
                            {
                                "id": str(tc_id),
                                "type": "function",
                                "function": {
                                    "name": str(fn_name),
                                    "arguments": str(fn_args),
                                },
                            }
                        )
                if tcs:
                    entry["tool_calls"] = tcs
                    if "content" not in entry:
                        # OpenAI requires content to be null (not missing)
                        # when tool_calls are present.
                        entry["content"] = None
            else:
                if "content" not in entry:
                    entry["content"] = ""
            out.append(entry)
            continue
        if role in ("user", "system", "developer"):
            content = (
                getattr(msg, "content", None)
                if not isinstance(msg, dict)
                else msg.get("content")
            )
            if isinstance(content, str):
                out.append({"role": role, "content": content})
    return out


def _runtime_tools_to_openai(tools: Any) -> list[dict[str, Any]]:
    """Convert the AG-UI ``RunAgentInput.tools`` array into OpenAI shape.

    The MCP Apps middleware on the TypeScript side advertises the remote
    MCP server's tools to the agent via this field. Each tool is a
    ``{ name, description, parameters }`` triple.
    """
    if not tools:
        return []
    converted: list[dict[str, Any]] = []
    for tool in tools:
        name = (
            getattr(tool, "name", None)
            if not isinstance(tool, dict)
            else tool.get("name")
        )
        if not isinstance(name, str) or not name:
            continue
        description = (
            getattr(tool, "description", "")
            if not isinstance(tool, dict)
            else tool.get("description", "")
        ) or ""
        parameters = (
            getattr(tool, "parameters", None)
            if not isinstance(tool, dict)
            else tool.get("parameters")
        )
        if parameters is None:
            parameters = {"type": "object", "properties": {}}
        converted.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": str(description),
                    "parameters": parameters,
                },
            }
        )
    return converted


# ---------------------------------------------------------------------------
# SSE plumbing
# ---------------------------------------------------------------------------


def _sse_line(event: Any) -> str:
    if hasattr(event, "model_dump"):
        data = event.model_dump(by_alias=True, exclude_none=True)
    else:
        data = dict(event)
    return f"data: {json.dumps(data)}\n\n"


async def handle_run(request: Request) -> StreamingResponse:
    """AG-UI ``/mcp-apps`` SSE handler — streams text + tool-call events."""
    error_id = str(uuid.uuid4())
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError) as exc:
        logger.exception("mcp-apps: failed to parse body (error_id=%s)", error_id)
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
        logger.exception("mcp-apps: invalid RunAgentInput (error_id=%s)", error_id)
        return JSONResponse(
            {
                "error": "Invalid RunAgentInput payload",
                "errorId": error_id,
                "class": exc.__class__.__name__,
            },
            status_code=422,
        )

    oai_messages = _agui_messages_to_openai(run_input.messages, _SYSTEM_PROMPT)
    oai_tools = _runtime_tools_to_openai(getattr(run_input, "tools", None))
    model = os.getenv("LANGROID_MODEL", "gpt-4o-mini")
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

        try:
            client = openai.AsyncOpenAI()
            response = await client.chat.completions.create(
                model=model,
                messages=oai_messages,
                tools=oai_tools if oai_tools else openai.NOT_GIVEN,
            )
        except (openai.APIError, httpx.HTTPError, asyncio.TimeoutError) as exc:
            logger.exception("mcp-apps: OpenAI call failed")
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

        choice = response.choices[0].message if response.choices else None
        if choice is None:
            yield _sse_line(
                RunFinishedEvent(
                    type=EventType.RUN_FINISHED,
                    thread_id=thread_id,
                    run_id=run_id,
                )
            )
            return

        # Emit any tool calls the model produced. The MCP Apps middleware on
        # the TypeScript side intercepts these to fetch the UI resource and
        # render the activity iframe.
        tool_calls = getattr(choice, "tool_calls", None) or []
        for tc in tool_calls:
            tc_id = str(getattr(tc, "id", None) or uuid.uuid4())
            fn = getattr(tc, "function", None)
            tc_name = getattr(fn, "name", "") if fn else ""
            tc_args = getattr(fn, "arguments", "") if fn else ""
            if not tc_name:
                continue
            yield _sse_line(
                ToolCallStartEvent(
                    type=EventType.TOOL_CALL_START,
                    tool_call_id=tc_id,
                    tool_call_name=tc_name,
                )
            )
            if tc_args:
                yield _sse_line(
                    ToolCallArgsEvent(
                        type=EventType.TOOL_CALL_ARGS,
                        tool_call_id=tc_id,
                        delta=str(tc_args),
                    )
                )
            yield _sse_line(
                ToolCallEndEvent(
                    type=EventType.TOOL_CALL_END,
                    tool_call_id=tc_id,
                )
            )

        # Surface any narration text the model produced alongside the tool
        # call. Many models reply with both a one-liner and a tool call.
        content = getattr(choice, "content", None) or ""
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
                TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=msg_id)
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
