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

import json
import os
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()

SLOW_SECONDS = float(os.getenv("SLOW_SECONDS", "3"))


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


@app.post("/v1/messages")
async def messages(request: Request) -> object:
    body = await request.body()
    is_stream = False
    try:
        payload = json.loads(body or b"{}")
        is_stream = bool(payload.get("stream"))
    except json.JSONDecodeError:
        pass

    # Block for SLOW_SECONDS to emulate a multi-second LLM round-trip. This
    # handler runs in its own process so it never steals cycles from the
    # system-under-test; the SUT's sync client blocks its calling thread for the
    # full duration of this call.
    time.sleep(SLOW_SECONDS)

    if is_stream:
        return StreamingResponse(
            iter([_streaming_body()]),
            media_type="text/event-stream",
        )
    return _nonstreaming_response()
