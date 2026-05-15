"""Langroid agent for the Declarative Generative UI (A2UI Fixed Schema) demo.

Fixed-schema A2UI: the component tree (schema) is authored ahead of time
as JSON and shipped with the backend. The agent only streams *data* into
the data model at runtime via the ``display_flight`` tool. The frontend
registers a matching catalog (see
``src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts``).

Mirrors the ``ag2`` integration's ``a2ui_fixed.py`` and the
``langgraph-python`` reference. The dedicated Next.js route at
``api/copilotkit-a2ui-fixed-schema/route.ts`` runs the A2UI middleware
with ``injectA2UITool: false`` because the backend agent owns the
``display_flight`` tool itself and emits an ``a2ui_operations`` container
in the tool result.

Wire pattern
------------
On each request we call OpenAI with a single ``display_flight`` tool
forced via ``tool_choice`` when the user prompt looks like a flight
query. The handler emits an AG-UI ``ToolCall`` triple for each tool call
the model produces, then immediately appends the ``a2ui_operations``
JSON as a tool-result text block. The runtime A2UI middleware on the
TypeScript side detects the ``a2ui_operations`` shape and forwards the
surface to the frontend renderer.

This handler is wired up by ``agent_server.py`` at
``POST /a2ui-fixed-schema``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from pathlib import Path
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


CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"


def _load_schema(filename: str) -> list[dict[str, Any]]:
    """Load an A2UI fixed schema from the local schemas directory."""
    with open(_SCHEMAS_DIR / filename, "r", encoding="utf-8") as fh:
        return json.load(fh)


FLIGHT_SCHEMA = _load_schema("flight_schema.json")


SYSTEM_PROMPT = (
    "You help users find flights. When asked about a flight, call "
    "display_flight with origin (3-letter code), destination (3-letter "
    "code), airline, and price (e.g. '$289'). Keep any chat reply to one "
    "short sentence."
)


# OpenAI tool spec — single ``display_flight`` tool.
_DISPLAY_FLIGHT_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "display_flight",
        "description": "Show a flight card for the given trip.",
        "parameters": {
            "type": "object",
            "properties": {
                "origin": {
                    "type": "string",
                    "description": "Origin airport code, e.g. 'SFO'.",
                },
                "destination": {
                    "type": "string",
                    "description": "Destination airport code, e.g. 'JFK'.",
                },
                "airline": {
                    "type": "string",
                    "description": "Airline name, e.g. 'United'.",
                },
                "price": {
                    "type": "string",
                    "description": "Price string, e.g. '$289'.",
                },
            },
            "required": ["origin", "destination", "airline", "price"],
        },
    },
}


def _build_a2ui_operations(
    *, origin: str, destination: str, airline: str, price: str
) -> dict[str, Any]:
    """Build the ``a2ui_operations`` container the runtime middleware
    detects in tool results and forwards to the frontend renderer.

    Mirrors ``ag2``'s ``a2ui_fixed.display_flight`` exactly so the frontend
    catalog binding in
    ``src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts`` resolves the
    component names against the local React components.
    """
    return {
        "a2ui_operations": [
            {
                "type": "create_surface",
                "surfaceId": SURFACE_ID,
                "catalogId": CATALOG_ID,
            },
            {
                "type": "update_components",
                "surfaceId": SURFACE_ID,
                "components": FLIGHT_SCHEMA,
            },
            {
                "type": "update_data_model",
                "surfaceId": SURFACE_ID,
                "data": {
                    "origin": origin,
                    "destination": destination,
                    "airline": airline,
                    "price": price,
                },
            },
        ]
    }


def _sse_line(event: Any) -> str:
    if hasattr(event, "model_dump"):
        data = event.model_dump(by_alias=True, exclude_none=True)
    else:
        data = dict(event)
    return f"data: {json.dumps(data)}\n\n"


def _agui_messages_to_openai(messages: Any) -> list[dict[str, Any]]:
    """Reduce inbound AG-UI messages to a simple OpenAI message list.

    We only need text-bearing user/assistant turns plus prior
    ``tool``-role messages keyed by ``tool_call_id`` so the model can
    follow up after a ``display_flight`` call. Anything else is
    skipped.
    """
    out: list[dict[str, Any]] = []
    if not messages:
        return out
    for msg in messages:
        if isinstance(msg, dict):
            role = msg.get("role")
            content = msg.get("content")
            tool_call_id = msg.get("tool_call_id")
            tool_calls = msg.get("tool_calls")
        else:
            role = getattr(msg, "role", None)
            content = getattr(msg, "content", None)
            tool_call_id = getattr(msg, "tool_call_id", None)
            tool_calls = getattr(msg, "tool_calls", None)

        if role == "tool" and tool_call_id:
            out.append(
                {
                    "role": "tool",
                    "tool_call_id": str(tool_call_id),
                    "content": str(content or ""),
                }
            )
            continue

        if role == "assistant":
            oai_msg: dict[str, Any] = {"role": "assistant"}
            if isinstance(content, str) and content:
                oai_msg["content"] = content
            if tool_calls:
                oai_tcs = []
                for tc in tool_calls:
                    if isinstance(tc, dict):
                        tc_id = tc.get("id")
                        fn = tc.get("function", {})
                        fn_name = fn.get("name", "") if isinstance(fn, dict) else ""
                        fn_args = (
                            fn.get("arguments", "") if isinstance(fn, dict) else ""
                        )
                    else:
                        tc_id = getattr(tc, "id", None)
                        fn = getattr(tc, "function", None)
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
            if "content" not in oai_msg and "tool_calls" not in oai_msg:
                oai_msg["content"] = ""
            out.append(oai_msg)
            continue

        if role in ("user", "system", "developer") and isinstance(content, str):
            out.append({"role": role, "content": content})

    return out


def _parse_tool_args(raw: Any) -> dict[str, Any] | None:
    """Parse OpenAI tool-call arguments (JSON string or dict) into a dict."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw or "{}")
        except (ValueError, TypeError):
            logger.warning("a2ui_fixed: failed to parse tool args: %r", raw)
            return None
        if isinstance(parsed, dict):
            return parsed
    return None


async def handle_run(request: Request) -> StreamingResponse:
    """AG-UI ``/a2ui-fixed-schema`` SSE handler.

    Drives a single OpenAI chat-completions turn with the
    ``display_flight`` tool exposed. If the model produces a tool call,
    we emit AG-UI ``TOOL_CALL_*`` events plus a tool-result text block
    containing the ``a2ui_operations`` JSON the Next.js runtime A2UI
    middleware detects and forwards to the frontend renderer.
    """
    error_id = str(uuid.uuid4())
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError) as exc:
        logger.exception("a2ui_fixed: failed to parse body (error_id=%s)", error_id)
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
        logger.exception("a2ui_fixed: invalid RunAgentInput (error_id=%s)", error_id)
        return JSONResponse(
            {
                "error": "Invalid RunAgentInput payload",
                "errorId": error_id,
                "class": exc.__class__.__name__,
            },
            status_code=422,
        )

    oai_messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *_agui_messages_to_openai(run_input.messages),
    ]
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

        client = openai.AsyncOpenAI()
        try:
            completion = await client.chat.completions.create(
                model=model,
                messages=oai_messages,
                tools=[_DISPLAY_FLIGHT_TOOL],
                tool_choice="auto",
                stream=False,
            )
        except (openai.APIError, httpx.HTTPError, asyncio.TimeoutError) as exc:
            logger.exception("a2ui_fixed: OpenAI call failed")
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

        message = completion.choices[0].message if completion.choices else None
        text_content = getattr(message, "content", None) or ""
        tool_calls = getattr(message, "tool_calls", None) or []

        # Parent message wraps tool calls so the runtime middleware
        # SSE parser can associate them — same pattern as the main
        # adapter (see agui_adapter.py).
        parent_id = str(uuid.uuid4())
        yield _sse_line(
            TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=parent_id,
            )
        )

        if text_content:
            yield _sse_line(
                TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=parent_id,
                    delta=text_content,
                )
            )

        for tc in tool_calls:
            fn = getattr(tc, "function", None)
            tool_name = getattr(fn, "name", None) if fn else None
            raw_args = getattr(fn, "arguments", "{}") if fn else "{}"
            tool_args = _parse_tool_args(raw_args)
            call_id = getattr(tc, "id", None) or str(uuid.uuid4())

            if tool_name != "display_flight" or tool_args is None:
                logger.warning(
                    "a2ui_fixed: skipping unexpected tool call %s", tool_name
                )
                continue

            yield _sse_line(
                ToolCallStartEvent(
                    type=EventType.TOOL_CALL_START,
                    tool_call_id=call_id,
                    tool_call_name=tool_name,
                    parent_message_id=parent_id,
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

            # Build the tool result containing the a2ui_operations
            # container. The Next.js runtime A2UI middleware detects
            # this shape and forwards the surface ops to the frontend.
            operations = _build_a2ui_operations(
                origin=str(tool_args.get("origin", "")),
                destination=str(tool_args.get("destination", "")),
                airline=str(tool_args.get("airline", "")),
                price=str(tool_args.get("price", "")),
            )
            tool_result_id = str(uuid.uuid4())
            yield _sse_line(
                TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END,
                    message_id=parent_id,
                )
            )
            # Emit the tool result as a fresh text block so the runtime
            # middleware-sse-parser sees the JSON payload as a tool-call
            # response.
            yield _sse_line(
                TextMessageStartEvent(
                    type=EventType.TEXT_MESSAGE_START,
                    message_id=tool_result_id,
                )
            )
            yield _sse_line(
                TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=tool_result_id,
                    delta=json.dumps(operations),
                )
            )
            yield _sse_line(
                TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END,
                    message_id=tool_result_id,
                )
            )

            # Single tool call per turn — finish after the first.
            yield _sse_line(
                RunFinishedEvent(
                    type=EventType.RUN_FINISHED,
                    thread_id=thread_id,
                    run_id=run_id,
                )
            )
            return

        # No tool call path — close the parent message and finish.
        yield _sse_line(
            TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=parent_id,
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
