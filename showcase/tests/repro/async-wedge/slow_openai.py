"""Controllable slow OpenAI-compatible mock endpoint.

Sibling of ``slow_anthropic.py`` for the OpenAI-SDK wedge sites (ag2
``beautiful_chat.py`` and llamaindex ``agent.py`` / ``a2ui_dynamic.py``). It
faithfully stands in for the real OpenAI Chat Completions API so the repro can
drive the *real* ``openai`` SDK client (its ``httpx`` transport) without network
access or an API key. The only thing we control is latency: every handler sleeps
``SLOW_SECONDS`` before responding, reproducing the load-bearing failure
construct — a multi-second LLM round-trip — while keeping the HTTP round-trip,
JSON (de)serialisation, and httpx transport all real.

The production ``generate_a2ui`` sites force a single ``render_a2ui`` tool call
via ``tool_choice``, so the mock returns a Chat Completions response whose
``choices[0].message.tool_calls[0]`` is a ``render_a2ui`` call with empty
``components`` — enough for ``build_a2ui_operations_from_tool_call`` (or the
llamaindex JSON passthrough) to parse.

Run standalone (own event loop / own process) so its latency never competes with
the system-under-test's event loop:

    uvicorn slow_openai:app --host 127.0.0.1 --port 8098
"""

from __future__ import annotations

import asyncio
import json
import os
import time

from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI()

SLOW_SECONDS = float(os.getenv("SLOW_SECONDS", "3"))


def _chat_completion_response() -> JSONResponse:
    # A forced render_a2ui tool call with valid JSON arguments so both the ag2
    # (build_a2ui_operations_from_tool_call) and llamaindex (JSON passthrough)
    # generators parse a real tool call.
    tool_args = json.dumps(
        {
            "surfaceId": "repro-surface",
            "catalogId": "repro-catalog",
            "components": [],
            "data": {},
        }
    )
    return JSONResponse(
        {
            "id": "chatcmpl-slowmock",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "gpt-4.1",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_render",
                                "type": "function",
                                "function": {
                                    "name": "render_a2ui",
                                    "arguments": tool_args,
                                },
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
            "usage": {
                "prompt_tokens": 1,
                "completion_tokens": 1,
                "total_tokens": 2,
            },
        }
    )


@app.post("/v1/chat/completions")
async def chat_completions() -> object:
    # Async sleep so the mock's own uvicorn loop stays free and services
    # concurrent SUT client threads in parallel. The SUT's sync client still
    # blocks its own calling thread for the full round trip, which is what the
    # repro exercises.
    await asyncio.sleep(SLOW_SECONDS)
    return _chat_completion_response()
