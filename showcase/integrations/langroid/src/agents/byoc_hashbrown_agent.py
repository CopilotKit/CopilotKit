"""BYOC: Hashbrown demo backend (Langroid).

Streams a single JSON object shaped like `@hashbrownai/react`'s
`useUiKit` schema so the frontend's progressive parser can turn it into
a sales dashboard as tokens arrive.

Wire format
-----------
The frontend (see ``src/app/demos/byoc-hashbrown/hashbrown-renderer.tsx``)
calls ``useJsonParser(content, kit.schema)``. ``kit.schema`` matches:

    {
      "ui": [
        { "metric":   { "props": { "label": "...", "value": "..." } } },
        { "pieChart": { "props": { "title": "...", "data": "[{...}]" } } },
        { "barChart": { "props": { "title": "...", "data": "[{...}]" } } },
        { "dealCard": { "props": { "title": "...", "stage": "...", "value": 0 } } },
        { "Markdown": { "props": { "children": "..." } } }
      ]
    }

This handler forces OpenAI's ``response_format: json_object`` mode and
streams the result as a single ``TEXT_MESSAGE`` triple. The progressive
parser on the frontend treats partial JSON gracefully — anything that
doesn't parse yet falls back to a no-op render until the next token
arrives.

The handler is wired up by ``agent_server.py`` at ``POST
/byoc-hashbrown``.
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
)
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse

logger = logging.getLogger(__name__)


# Mirrors the langgraph-python byoc_hashbrown system prompt. The
# example payload at the bottom is critical — without a worked example
# the model frequently emits the wrong nesting (e.g. multi-key objects
# instead of single-key `{tagName: {props: {...}}}` entries).
_SYSTEM_PROMPT = """\
You are a sales analytics assistant that replies by emitting a single JSON
object consumed by a streaming JSON parser on the frontend.

ALWAYS respond with a single JSON object of the form:

{
  "ui": [
    { <componentName>: { "props": { ... } } },
    ...
  ]
}

Do NOT wrap the response in code fences. Do NOT include any preface or
explanation outside the JSON object. The response MUST be valid JSON.

Available components and their prop schemas:

- "metric": { "props": { "label": string, "value": string } }
    A KPI card. `value` is a pre-formatted string like "$1.2M" or "248".

- "pieChart": { "props": { "title": string, "data": string } }
    A donut chart. `data` is a JSON-encoded STRING (embedded JSON) of an
    array of {label, value} objects with at least 3 segments, e.g.
    "data": "[{\\"label\\":\\"Enterprise\\",\\"value\\":600000}]".

- "barChart": { "props": { "title": string, "data": string } }
    A vertical bar chart. `data` is a JSON-encoded STRING of an array of
    {label, value} objects with at least 3 bars, typically time-ordered.

- "dealCard": { "props": { "title": string, "stage": string, "value": number } }
    A single sales deal. `stage` MUST be one of: "prospect", "qualified",
    "proposal", "negotiation", "closed-won", "closed-lost". `value` is a
    raw number (no currency symbol or comma).

- "Markdown": { "props": { "children": string } }
    Short explanatory text. Use for section headings and brief summaries.
    Standard markdown is supported in `children`.

Rules:
- Always produce plausible sample data when the user asks for a dashboard or
  chart — do not refuse for lack of data.
- Prefer 3-6 rows of data in charts; keep labels short.
- Use "Markdown" for short headings or linking sentences between visual
  components. Do not emit long prose.
- Do not emit components that are not listed above.
- `data` props on charts MUST be a JSON STRING — escape inner quotes.

Example response (sales dashboard):
{"ui":[{"Markdown":{"props":{"children":"## Q4 Sales Summary"}}},{"metric":{"props":{"label":"Total Revenue","value":"$1.2M"}}},{"metric":{"props":{"label":"New Customers","value":"248"}}},{"pieChart":{"props":{"title":"Revenue by Segment","data":"[{\\"label\\":\\"Enterprise\\",\\"value\\":600000},{\\"label\\":\\"SMB\\",\\"value\\":400000},{\\"label\\":\\"Startup\\",\\"value\\":200000}]"}}},{"barChart":{"props":{"title":"Monthly Revenue","data":"[{\\"label\\":\\"Oct\\",\\"value\\":350000},{\\"label\\":\\"Nov\\",\\"value\\":400000},{\\"label\\":\\"Dec\\",\\"value\\":450000}]"}}}]}
"""


def _sse_line(event: Any) -> str:
    if hasattr(event, "model_dump"):
        data = event.model_dump(by_alias=True, exclude_none=True)
    else:
        data = dict(event)
    return f"data: {json.dumps(data)}\n\n"


def _flatten_user_messages(messages: Any) -> list[dict[str, Any]]:
    """Reduce inbound AG-UI messages to a simple OpenAI message list.

    The hashbrown demo is single-turn-ish — we want the model to emit a
    fresh JSON envelope for the latest user prompt, not a continuation.
    Accept all `user`/`assistant` text-only turns; skip tool messages
    (irrelevant — this agent has no tools).
    """
    out: list[dict[str, Any]] = []
    if not messages:
        return out
    for msg in messages:
        role = (
            getattr(msg, "role", None) if not isinstance(msg, dict) else msg.get("role")
        )
        content = (
            getattr(msg, "content", None)
            if not isinstance(msg, dict)
            else msg.get("content")
        )
        if (
            isinstance(role, str)
            and role in ("user", "assistant")
            and isinstance(content, str)
        ):
            out.append({"role": role, "content": content})
    return out


async def _stream_json_response(
    *,
    system_prompt: str,
    user_messages: list[dict[str, Any]],
    model: str,
) -> AsyncGenerator[str, None]:
    """Yield raw JSON text deltas from OpenAI streaming chat completion."""
    client = openai.AsyncOpenAI()
    stream = await client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system_prompt}, *user_messages],
        response_format={"type": "json_object"},
        stream=True,
    )
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        text = getattr(delta, "content", None)
        if text:
            yield text


async def _run_byoc(
    *,
    system_prompt: str,
    request: Request,
    default_model: str,
) -> StreamingResponse:
    """Shared SSE plumbing for both BYOC demos.

    Both endpoints differ only in their system prompt — extracted so the
    sister `byoc_json_render_agent` module can call straight in without
    duplicating the parsing / streaming / error envelope.
    """
    error_id = str(uuid.uuid4())
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError) as exc:
        logger.exception("byoc: failed to parse body (error_id=%s)", error_id)
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
        logger.exception("byoc: invalid RunAgentInput (error_id=%s)", error_id)
        return JSONResponse(
            {
                "error": "Invalid RunAgentInput payload",
                "errorId": error_id,
                "class": exc.__class__.__name__,
            },
            status_code=422,
        )

    user_messages = _flatten_user_messages(run_input.messages)
    model = os.getenv("LANGROID_MODEL", default_model)
    thread_id = run_input.thread_id or str(uuid.uuid4())

    async def event_stream() -> AsyncGenerator[str, None]:
        run_id = str(uuid.uuid4())
        message_id = str(uuid.uuid4())

        yield _sse_line(
            RunStartedEvent(
                type=EventType.RUN_STARTED,
                thread_id=thread_id,
                run_id=run_id,
            )
        )
        yield _sse_line(
            TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START, message_id=message_id
            )
        )

        try:
            async for delta in _stream_json_response(
                system_prompt=system_prompt,
                user_messages=user_messages,
                model=model,
            ):
                yield _sse_line(
                    TextMessageContentEvent(
                        type=EventType.TEXT_MESSAGE_CONTENT,
                        message_id=message_id,
                        delta=delta,
                    )
                )
        except (openai.APIError, httpx.HTTPError, asyncio.TimeoutError) as exc:
            logger.exception("byoc: OpenAI streaming call failed")
            yield _sse_line(
                TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END, message_id=message_id
                )
            )
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

        yield _sse_line(
            TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=message_id)
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


async def handle_run(request: Request) -> StreamingResponse:
    """AG-UI ``/byoc-hashbrown`` SSE handler."""
    return await _run_byoc(
        system_prompt=_SYSTEM_PROMPT,
        request=request,
        default_model="gpt-4o-mini",
    )
