"""Controllable slow Anthropic-compatible mock endpoint.

Faithfully stands in for the real Anthropic Messages API so the repro can drive
the *real* ``anthropic`` SDK clients (their ``httpx`` transports) without
network access or an API key. The only thing we control is latency: every
handler sleeps ``SLOW_SECONDS`` before responding, reproducing the load-bearing
failure construct — a multi-second LLM round-trip — while keeping the HTTP
round-trip, JSON (de)serialisation, and httpx transport all real.

This is the "controllable slow endpoint" the repro spec permits in lieu of
aimock (aimock is a Docker fleet service; a hermetic local endpoint is the
faithful equivalent for exercising the sync-client-on-the-loop blocking path).

Serves both request shapes used by the production code:
  * non-streaming ``messages.create()`` (server.py replica + secondary
    ``_generate_a2ui`` call) -> a single JSON Messages response whose content
    is a ``render_a2ui`` tool_use (so build_a2ui_operations_from_tool_call has
    something to parse).
  * streaming ``messages.stream()`` (primary a2ui_dynamic loop) -> an SSE event
    sequence emitting a ``generate_a2ui`` tool_use, so the generator proceeds to
    the secondary call.

Run standalone (own event loop / own process) so its latency never competes
with the system-under-test's event loop:

    uvicorn slow_anthropic:app --host 127.0.0.1 --port 8099
"""

from __future__ import annotations

import asyncio
import json
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()

SLOW_SECONDS = float(os.getenv("SLOW_SECONDS", "3"))

# False-green fault injection (test-of-the-test only): when set, the streaming
# response omits the generate_a2ui tool_use and emits a text block instead, so
# the production generator drains chunks but NEVER reaches _generate_a2ui. Used
# by the red-green proof to confirm the hardened GREEN assertion
# (tool_dispatch_fired >= 1) FAILS on a dropped-tool-use false green rather than
# trivially passing on WEDGE==0. Unset in normal operation.
DROP_TOOL_USE = os.getenv("REPRO_DROP_TOOL_USE", "0").strip().lower() in ("1", "true")


def _nonstreaming_response() -> JSONResponse:
    # A render_a2ui tool_use so the secondary _generate_a2ui call can parse it.
    return JSONResponse(
        {
            "id": "msg_slowmock",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-6",
            "content": [
                {
                    "type": "tool_use",
                    "id": "toolu_render",
                    "name": "render_a2ui",
                    "input": {"components": []},
                }
            ],
            "stop_reason": "tool_use",
            "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }
    )


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _streaming_body() -> str:
    # Minimal Anthropic SSE sequence emitting a generate_a2ui tool_use.
    parts = [
        _sse(
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": "msg_slowmock_stream",
                    "type": "message",
                    "role": "assistant",
                    "model": "claude-sonnet-4-6",
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": 1, "output_tokens": 0},
                },
            },
        ),
        _sse(
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {
                    "type": "tool_use",
                    "id": "toolu_gen",
                    "name": "generate_a2ui",
                    "input": {},
                },
            },
        ),
        _sse(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {
                    "type": "input_json_delta",
                    "partial_json": '{"context": "Q1 sales dashboard"}',
                },
            },
        ),
        _sse("content_block_stop", {"type": "content_block_stop", "index": 0}),
        _sse(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": "tool_use", "stop_sequence": None},
                "usage": {"output_tokens": 1},
            },
        ),
        _sse("message_stop", {"type": "message_stop"}),
    ]
    return "".join(parts)


def _streaming_body_text_only() -> str:
    # Fault-injection body (DROP_TOOL_USE): a valid streaming response with a
    # text block and NO generate_a2ui tool_use, so the generator finishes but
    # never dispatches the tool. Reproduces the M1 false-green scenario.
    parts = [
        _sse(
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": "msg_slowmock_stream",
                    "type": "message",
                    "role": "assistant",
                    "model": "claude-sonnet-4-6",
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": 1, "output_tokens": 0},
                },
            },
        ),
        _sse(
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "text", "text": ""},
            },
        ),
        _sse(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "No tool for you."},
            },
        ),
        _sse("content_block_stop", {"type": "content_block_stop", "index": 0}),
        _sse(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                "usage": {"output_tokens": 1},
            },
        ),
        _sse("message_stop", {"type": "message_stop"}),
    ]
    return "".join(parts)


@app.post("/v1/messages")
async def messages(request: Request) -> object:
    body = await request.body()
    is_stream = False
    try:
        payload = json.loads(body or b"{}")
        is_stream = bool(payload.get("stream"))
    except json.JSONDecodeError:
        pass

    # Delay for SLOW_SECONDS to emulate a multi-second LLM round-trip. Use the
    # async sleep so this mock's own uvicorn loop stays free and can service
    # concurrent SUT client threads in parallel (a blocking time.sleep here
    # serialises them and needlessly extends the test under CONCURRENCY>1). The
    # SUT's sync client still blocks its own calling thread for the full round
    # trip, which is what the repro exercises.
    await asyncio.sleep(SLOW_SECONDS)

    if is_stream:
        body = _streaming_body_text_only() if DROP_TOOL_USE else _streaming_body()
        return StreamingResponse(
            iter([body]),
            media_type="text/event-stream",
        )
    return _nonstreaming_response()
