"""Multimodal demo backend (Langroid).

Vision-capable agent (gpt-4o) for the ``/demos/multimodal`` cell. Accepts
image and PDF attachments injected via CopilotChat's AttachmentsConfig
pipeline. Mirrors the langgraph-python sibling
(``showcase/integrations/langgraph-python/src/agents/multimodal_agent.py``)
so the two demos exercise comparable behavior.

Wire format
===========
Attachments arrive in user-message content as either:

1. ``{"type": "image", "source": {"type": "data", "value": "<b64>",
   "mimeType": "image/png"}}`` — modern AG-UI shape that CopilotChat
   emits natively.
2. ``{"type": "binary", "mimeType": "application/pdf", "data": "<b64>"}``
   — legacy AG-UI binary part the langgraph-python integration's
   ``onRunInitialized`` shim normalizes to. Kept for interop in case a
   future runtime path forwards through that converter.

Image parts are forwarded to OpenAI as ``image_url`` content parts with
inline ``data:<mime>;base64,...`` URLs; gpt-4o reads them natively. PDF
parts are flattened to text with ``pypdf`` (gpt-4o cannot read PDFs
directly), with a typed placeholder when extraction fails so the model
can at least tell the user the document was unreadable.

Wired up by ``agent_server.py`` at ``POST /multimodal``.
"""

from __future__ import annotations

import asyncio
import base64
import io
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


_SYSTEM_PROMPT = (
    "You are a helpful assistant. The user may attach images or documents "
    "(PDFs). When they do, analyze the attachment carefully and answer the "
    "user's question. If no attachment is present, answer the text question "
    "normally. Keep responses concise (1-3 sentences) unless asked to go deep."
)


# ---------------------------------------------------------------------------
# PDF flattening
# ---------------------------------------------------------------------------


def _extract_pdf_text(b64: str) -> str:
    """Decode an inline-base64 PDF and extract its text.

    Returns an empty string when decoding or extraction fails. Caller
    decides whether to inline the text or substitute a placeholder.
    """
    try:
        raw = base64.b64decode(b64, validate=False)
    except (ValueError, TypeError) as exc:
        logger.warning("multimodal: base64 decode failed: %s", exc)
        return ""
    try:
        # Lazy import — keeps the module importable even if pypdf is
        # missing at dev-server boot.
        from pypdf import PdfReader  # type: ignore[import-not-found]
    except ImportError as exc:
        logger.warning(
            "multimodal: pypdf not installed — PDF text unavailable: %s", exc
        )
        return ""
    try:
        reader = PdfReader(io.BytesIO(raw))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(pages).strip()
    except Exception as exc:  # noqa: BLE001 — pypdf failure shouldn't 500 the run
        logger.warning("multimodal: pypdf extraction failed: %s", exc)
        return ""


# ---------------------------------------------------------------------------
# Content-part normalization
# ---------------------------------------------------------------------------


def _normalize_part(part: Any) -> dict[str, Any] | None:
    """Map an inbound content part to an OpenAI content part.

    Returns ``None`` when the part is not understood (caller can drop or
    fall back to text). Recognises:

    - ``{"type": "text", "text": "..."}`` — passthrough.
    - ``{"type": "image", "source": {"type": "data", "value": "<b64>", "mimeType": "..."}}``
    - ``{"type": "document", "source": {"type": "data", "value": "<b64>", "mimeType": "..."}}``
    - ``{"type": "binary", "mimeType": "...", "data": "<b64>"}`` (legacy)
    - ``{"type": "image_url", "image_url": {"url": "data:..."}}`` (already OpenAI shape)
    - bare strings (treated as text).
    - Pydantic model instances (e.g. ``TextInputContent``, ``ImageInputContent``,
      ``DocumentInputContent`` from ``ag_ui.core``) — converted to dicts via
      ``model_dump()`` so the rest of the function can use ``.get()``.
    """
    if isinstance(part, str):
        if not part:
            return None
        return {"type": "text", "text": part}
    # Pydantic model instances (from ag_ui.core deserialization) are not
    # dicts but expose model_dump(). Convert once so the rest of the
    # function can use dict-style .get() access uniformly.
    if not isinstance(part, dict):
        if hasattr(part, "model_dump"):
            part = part.model_dump(by_alias=True)
        else:
            return None
    ptype = part.get("type")

    if ptype == "text":
        text = part.get("text")
        if isinstance(text, str) and text:
            return {"type": "text", "text": text}
        return None

    if ptype == "image_url":
        # Already OpenAI shape — pass through after light validation.
        image_url = part.get("image_url")
        if isinstance(image_url, str) and image_url:
            return {"type": "image_url", "image_url": {"url": image_url}}
        if isinstance(image_url, dict):
            url = image_url.get("url")
            if isinstance(url, str) and url:
                return {"type": "image_url", "image_url": {"url": url}}
        return None

    if ptype in ("image", "document"):
        source = part.get("source")
        if not isinstance(source, dict):
            return None
        if source.get("type") != "data":
            # url-based parts not supported by this agent path today —
            # the demo only emits inline base64.
            return None
        value = source.get("value")
        mime = source.get("mimeType")
        if not isinstance(value, str) or not isinstance(mime, str):
            return None
        if ptype == "image" or mime.startswith("image/"):
            return {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{value}"},
            }
        if "pdf" in mime.lower():
            text = _extract_pdf_text(value)
            if not text:
                return {
                    "type": "text",
                    "text": "[Attached document: PDF could not be read.]",
                }
            return {"type": "text", "text": f"[Attached document]\n{text}"}
        return None

    if ptype == "binary":
        mime = part.get("mimeType") or ""
        data = part.get("data")
        if not isinstance(mime, str) or not isinstance(data, str):
            return None
        if mime.startswith("image/"):
            return {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{data}"},
            }
        if "pdf" in mime.lower():
            text = _extract_pdf_text(data)
            if not text:
                return {
                    "type": "text",
                    "text": "[Attached document: PDF could not be read.]",
                }
            return {"type": "text", "text": f"[Attached document]\n{text}"}
        return None

    return None


def _build_user_content(content: Any) -> Any:
    """Translate user-message content into an OpenAI-compatible payload.

    Returns either a raw string (when there's only one text part — a
    common single-message case) or the list-of-parts shape that gpt-4o
    expects for multimodal turns.
    """
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[dict[str, Any]] = []
    for raw in content:
        normalized = _normalize_part(raw)
        if normalized is not None:
            parts.append(normalized)
    if not parts:
        return ""
    if len(parts) == 1 and parts[0].get("type") == "text":
        return parts[0].get("text") or ""
    return parts


def _build_messages(messages: Any, system_prompt: str) -> list[dict[str, Any]]:
    """Build the OpenAI messages list, preserving multimodal user parts."""
    out: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    if not messages:
        return out
    for msg in messages:
        role = (
            getattr(msg, "role", None) if not isinstance(msg, dict) else msg.get("role")
        )
        if not isinstance(role, str):
            continue
        content = (
            getattr(msg, "content", None)
            if not isinstance(msg, dict)
            else msg.get("content")
        )
        if role == "user":
            built = _build_user_content(content)
            if built:
                out.append({"role": "user", "content": built})
        elif role == "assistant":
            if isinstance(content, str) and content:
                out.append({"role": "assistant", "content": content})
        elif role == "system":
            if isinstance(content, str) and content:
                out.append({"role": "system", "content": content})
    return out


# ---------------------------------------------------------------------------
# SSE handler
# ---------------------------------------------------------------------------


def _sse_line(event: Any) -> str:
    if hasattr(event, "model_dump"):
        data = event.model_dump(by_alias=True, exclude_none=True)
    else:
        data = dict(event)
    return f"data: {json.dumps(data)}\n\n"


async def handle_run(request: Request) -> StreamingResponse:
    """AG-UI ``/multimodal`` SSE handler — vision-capable streaming."""
    error_id = str(uuid.uuid4())
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError) as exc:
        logger.exception("multimodal: failed to parse body (error_id=%s)", error_id)
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
        logger.exception("multimodal: invalid RunAgentInput (error_id=%s)", error_id)
        return JSONResponse(
            {
                "error": "Invalid RunAgentInput payload",
                "errorId": error_id,
                "class": exc.__class__.__name__,
            },
            status_code=422,
        )

    oai_messages = _build_messages(run_input.messages, _SYSTEM_PROMPT)
    # Force a vision-capable model. We deliberately ignore LANGROID_MODEL
    # here — the unified text-only agents are configured with cheaper
    # models, and this demo's whole point is the vision path.
    model = os.getenv("MULTIMODAL_MODEL", "gpt-4o")
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
            client = openai.AsyncOpenAI()
            stream = await client.chat.completions.create(
                model=model,
                messages=oai_messages,
                stream=True,
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                text = getattr(delta, "content", None)
                if text:
                    yield _sse_line(
                        TextMessageContentEvent(
                            type=EventType.TEXT_MESSAGE_CONTENT,
                            message_id=message_id,
                            delta=text,
                        )
                    )
        except (openai.APIError, httpx.HTTPError, asyncio.TimeoutError) as exc:
            logger.exception("multimodal: OpenAI streaming call failed")
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
