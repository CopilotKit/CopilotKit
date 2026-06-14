"""AG-UI → autogen multimodal content normalization for the AG2 backend.

Problem
-------
The ``multimodal`` showcase cell sends user messages whose ``content`` is a
list of AG-UI ``InputContent`` parts. The shapes that actually arrive on
the wire are:

* Modern AG-UI image:
  ``{"type": "image", "source": {"type": "data" | "url", "value": "...",
  "mimeType" | "mime_type": "image/png"}}``
* Modern AG-UI document (PDF, etc):
  ``{"type": "document", "source": {...}}``
* Legacy AG-UI binary mirror (appended by
  ``src/app/demos/multimodal/legacy-converter-shim.tsx``):
  ``{"type": "binary", "mimeType": "image/png", "data": "..." | "url": "..."}``

AG2's ``ConversableAgent`` runs every user message through
``autogen.code_utils.content_str``, which only accepts content-part types
``{"text", "input_text", "image_url", "input_image", "function",
"tool_call", "tool_calls"}``. Any other ``type`` raises
``ValueError("Wrong content format: unknown type <type> within the
content")`` BEFORE the request reaches the model — observed live in the
D6 ``multimodal`` probe (image turn errored out with that message; see
commit d8a0a25db for the symptom report and the original NSF
quarantine).

Fix
---
A raw-ASGI middleware sitting in front of the multimodal sub-app reads
the inbound ``RunAgentInput`` JSON body, rewrites each user message's
content list so AG-UI image / document / binary parts become OpenAI Chat
Completions ``image_url`` parts (which autogen accepts and forwards to
the vision-capable model natively), and replays the rewritten body to
the downstream ASGI app.

* ``{"type": "image", "source": ...}`` → ``{"type": "image_url",
  "image_url": {"url": "data:<mime>;base64,<payload>" | "<url>"}}``
* ``{"type": "document", "source": ...}`` and ``{"type": "binary",
  mimeType=application/pdf}`` → ``{"type": "image_url", "image_url":
  {"url": "data:application/pdf;base64,<payload>"}}`` so the PDF
  payload survives autogen's allowed-types gate. The vision model
  itself cannot read PDFs natively, but
  ``multimodal_agent.system_message`` / the agent's prompt only need
  the image path GREEN for the D6 ``multimodal`` probe; PDF rendering
  is a separate concern.
* ``{"type": "binary", mimeType=image/*}`` → ``{"type": "image_url",
  "image_url": {"url": "data:<mime>;base64,<payload>" | "<url>"}}``.
* Plain ``{"type": "text", ...}`` and unrecognised shapes pass through
  unchanged so we never break a working request that didn't need
  normalization in the first place (idempotency: re-running on
  already-normalized content is a no-op).

The middleware is installed ONLY on the ``multimodal_app`` sub-app
(``agents/multimodal_agent.py``), not on the global FastAPI server in
``agent_server.py`` — keeping the blast radius scoped to the one route
that actually sees image content parts. Other ag2 routes never receive
these shapes and don't pay the body-buffer cost.

Failures are intentionally NON-fatal: any body-parse failure (non-JSON,
schema drift, etc.) is logged at WARNING and the request is replayed
unchanged to the downstream app, which will then raise autogen's
original ``ValueError`` (visibility into the failure path rather than
silent swallowing).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)


_IMAGE_URL_TYPE = "image_url"
_TEXT_TYPE = "text"


def _build_data_url(mime: str, payload: str) -> str:
    """Assemble a ``data:<mime>;base64,<payload>`` URL.

    The OpenAI Chat Completions ``image_url`` part accepts either a
    plain ``https://`` URL or an inline base64 data URL — both flow
    through autogen's ``content_str`` allowed-types gate as
    ``image_url``. Building a data URL from the AG-UI ``data`` source
    keeps the inline payload intact end-to-end.
    """
    return f"data:{mime};base64,{payload}"


def _normalize_modern_part(part: dict[str, Any]) -> dict[str, Any] | None:
    """Convert a modern AG-UI ``image`` / ``document`` part to ``image_url``.

    Returns ``None`` if the shape is unrecognised — the caller passes
    the original part through unchanged in that case.

    Modern AG-UI content shape (see ``ag_ui.core.types.ImageInputContent``):
        ``{"type": "image" | "document",
            "source": {"type": "data" | "url",
                       "value": "<base64>" | "<https://...>",
                       "mime_type" | "mimeType": "..."}}``
    """
    source = part.get("source")
    if not isinstance(source, dict):
        return None
    value = source.get("value")
    if not isinstance(value, str) or not value:
        return None
    # The AG-UI pydantic model uses ``mime_type``; the legacy converter
    # shim and some hand-rolled payloads use ``mimeType``. Accept both
    # so a frontend running either schema version round-trips cleanly.
    mime = source.get("mime_type") or source.get("mimeType") or ""
    if not isinstance(mime, str) or not mime:
        # Fall back to a generic mime so the URL is at least well-formed
        # data:URL syntax. The model side will likely ignore an unknown
        # mime, but autogen's allowed-types gate only inspects ``type``.
        mime = "application/octet-stream"
    src_type = source.get("type")
    if src_type == "url":
        # Pass URL-source values through as the image_url url directly.
        return {"type": _IMAGE_URL_TYPE, "image_url": {"url": value}}
    if src_type == "data":
        return {
            "type": _IMAGE_URL_TYPE,
            "image_url": {"url": _build_data_url(mime, value)},
        }
    return None


def _normalize_legacy_binary_part(part: dict[str, Any]) -> dict[str, Any] | None:
    """Convert a legacy AG-UI ``binary`` part to ``image_url``.

    The frontend at ``src/app/demos/multimodal/legacy-converter-shim.tsx``
    APPENDS one of these alongside every modern ``image``/``document``
    part to feed the @ag-ui/langgraph converter (LangChain integrations
    only understand the legacy shape). Those appended parts ride along
    on the same payload that hits the AG2 backend, and autogen also
    rejects ``binary`` as an unknown content type. Normalising them
    here turns the round-trip into a no-op for AG2 instead of a hard
    rejection.

    Shape:
        ``{"type": "binary", "mimeType": "<mime>",
            "data": "<base64>" | "url": "<https://...>"}``
    """
    mime = part.get("mimeType") or part.get("mime_type") or "application/octet-stream"
    if not isinstance(mime, str):
        mime = "application/octet-stream"
    data = part.get("data")
    if isinstance(data, str) and data:
        return {
            "type": _IMAGE_URL_TYPE,
            "image_url": {"url": _build_data_url(mime, data)},
        }
    url = part.get("url")
    if isinstance(url, str) and url:
        return {"type": _IMAGE_URL_TYPE, "image_url": {"url": url}}
    return None


def _normalize_content_part(part: Any) -> Any:
    """Return an autogen-acceptable content part for ``part``.

    Recognised conversions:
        * ``{"type": "image", "source": ...}`` → ``image_url``
        * ``{"type": "document", "source": ...}`` → ``image_url`` (data
          URL with the original mime; vision model gets the raw bytes
          and the system prompt steers it on what to do with them)
        * ``{"type": "binary", ...}`` → ``image_url``

    Everything else (``text``, already-normalised ``image_url``,
    unknown shapes) passes through untouched. Returning the original
    part on no-op keeps the rewrite idempotent and preserves any extra
    keys autogen / the model might consume.
    """
    if not isinstance(part, dict):
        return part
    part_type = part.get("type")
    if part_type in ("image", "document", "audio", "video"):
        normalized = _normalize_modern_part(part)
        if normalized is not None:
            return normalized
        # Recognised modality with an unrecognised source — log and
        # drop to a plain text placeholder so autogen accepts the
        # part instead of choking. Without this, an empty/malformed
        # source would survive as ``image``/``document`` and trip the
        # exact ValueError we're working around.
        logger.warning(
            "[ag2:multimodal-normalize] dropping unrecognised %s source "
            "shape; replacing with text placeholder",
            part_type,
        )
        return {
            "type": _TEXT_TYPE,
            "text": f"[unreadable {part_type} attachment]",
        }
    if part_type == "binary":
        normalized = _normalize_legacy_binary_part(part)
        if normalized is not None:
            return normalized
        logger.warning(
            "[ag2:multimodal-normalize] dropping unrecognised binary shape; "
            "replacing with text placeholder",
        )
        return {
            "type": _TEXT_TYPE,
            "text": "[unreadable binary attachment]",
        }
    return part


def normalize_messages_for_autogen(messages: Any) -> Any:
    """Rewrite ``RunAgentInput.messages`` so AG-UI multimodal parts are
    converted to autogen-acceptable ``image_url`` parts.

    Returns the input value untouched if it is not the expected list
    shape (parse-time schema drift; the downstream app will report a
    real error from its own validation). Otherwise returns a NEW list
    with rewritten user-message content; non-user messages are
    forwarded as-is.

    The function is pure: it never mutates the input. This keeps the
    body-replay path in the ASGI middleware easy to reason about
    (buffer raw body → parse → rewrite → re-serialize → replay).
    """
    if not isinstance(messages, list):
        return messages
    rewritten: list[Any] = []
    for msg in messages:
        if not isinstance(msg, dict):
            rewritten.append(msg)
            continue
        if msg.get("role") != "user":
            rewritten.append(msg)
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            # String content (plain text) and ``None`` pass through
            # untouched. Autogen accepts both.
            rewritten.append(msg)
            continue
        new_content = [_normalize_content_part(part) for part in content]
        if new_content == content:
            # No-op for this message — preserve the original dict so we
            # never accidentally drop a key the downstream app reads.
            rewritten.append(msg)
            continue
        new_msg = dict(msg)
        new_msg["content"] = new_content
        rewritten.append(new_msg)
    return rewritten


class MultimodalContentNormalizerMiddleware:
    """Raw-ASGI middleware that normalises AG-UI image/document parts.

    Implemented at raw ASGI (not ``BaseHTTPMiddleware``) for the same
    reason ``RequestUserMessageMiddleware`` is: we need to BOTH inspect
    and rewrite the inbound request body AND replay it intact to the
    downstream app. ``BaseHTTPMiddleware`` does not re-emit consumed
    body chunks, which would truncate the request to autogen.

    Scope: applies to POST requests with a JSON body. Non-POST and
    non-HTTP scopes pass through untouched. Parse failures replay the
    ORIGINAL body to the downstream app (so autogen's own error path
    fires with the verbatim payload) rather than the partially-mutated
    one — failure-mode containment, not silent rewrite.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") != "POST":
            await self.app(scope, receive, send)
            return

        # Buffer the entire request body so we can both inspect/rewrite
        # it AND replay it to the inner ASGI app via a wrapped
        # ``receive`` callable. Mirrors RequestUserMessageMiddleware.
        body_chunks: list[bytes] = []
        more_body = True
        client_disconnected = False
        while more_body:
            message = await receive()
            if message["type"] == "http.request":
                body_chunks.append(message.get("body", b"") or b"")
                more_body = bool(message.get("more_body", False))
            elif message["type"] == "http.disconnect":
                client_disconnected = True
                more_body = False
            else:
                more_body = False

        raw = b"".join(body_chunks)

        if client_disconnected:
            logger.warning(
                "[ag2:multimodal-normalize] client disconnected before "
                "request body fully received (%d bytes buffered); "
                "short-circuiting without invoking downstream app",
                len(raw),
            )
            return

        # Try to parse + rewrite. Any failure ⇒ replay the ORIGINAL
        # body so autogen's own error path fires verbatim.
        new_raw = raw
        if raw:
            try:
                payload = json.loads(raw)
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                logger.warning(
                    "[ag2:multimodal-normalize] body is not valid JSON "
                    "(%s); replaying original body to downstream app",
                    exc,
                )
            else:
                if isinstance(payload, dict) and "messages" in payload:
                    try:
                        new_messages = normalize_messages_for_autogen(
                            payload["messages"]
                        )
                    except Exception as exc:  # noqa: BLE001 - log + fall back
                        logger.warning(
                            "[ag2:multimodal-normalize] normalize failed "
                            "(%s); replaying original body to downstream app",
                            exc,
                            exc_info=True,
                        )
                    else:
                        if new_messages is not payload["messages"]:
                            payload = {**payload, "messages": new_messages}
                            try:
                                new_raw = json.dumps(payload).encode("utf-8")
                            except (TypeError, ValueError) as exc:
                                logger.warning(
                                    "[ag2:multimodal-normalize] re-encode "
                                    "failed (%s); replaying original body",
                                    exc,
                                )
                                new_raw = raw

        # Replay the rewritten (or original) body to the downstream app.
        # Update Content-Length in scope.headers so Starlette/uvicorn's
        # body-length tracking matches the bytes we send. Without this
        # an inner app that reads ``content-length`` to size its buffer
        # would short-read the rewritten body.
        if new_raw is not raw:
            scope = _with_content_length(scope, len(new_raw))

        replayed = False
        original_receive = receive

        async def _replay_receive() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {
                    "type": "http.request",
                    "body": new_raw,
                    "more_body": False,
                }
            # Mirror RequestUserMessageMiddleware: post-body, await the
            # real upstream receive so SSE long-polls (http.disconnect)
            # propagate. NEVER synthesise a disconnect — that would
            # prematurely cancel the inner SSE stream.
            message = await original_receive()
            while message.get("type") == "http.request":
                logger.warning(
                    "[ag2:multimodal-normalize] unexpected http.request "
                    "after body drain (body_len=%d); awaiting real "
                    "disconnect",
                    len(message.get("body", b"") or b""),
                )
                message = await original_receive()
            return message

        await self.app(scope, _replay_receive, send)


def _with_content_length(scope: Scope, length: int) -> Scope:
    """Return a copy of ``scope`` with ``content-length`` rewritten.

    ASGI scope ``headers`` is a list of ``(name, value)`` byte tuples.
    We rebuild the list with the rewritten content-length so the inner
    app's framework (e.g. Starlette's ``Request.body()``) sees a length
    consistent with the replayed body bytes. ``transfer-encoding:
    chunked`` requests (no ``content-length`` header at all) are left
    untouched — the rewritten ``more_body=False`` chunk already tells
    the inner app the body has ended.
    """
    headers = scope.get("headers")
    if not isinstance(headers, list):
        return scope
    new_headers: list[tuple[bytes, bytes]] = []
    found = False
    for name, value in headers:
        if name.lower() == b"content-length":
            new_headers.append((name, str(length).encode("ascii")))
            found = True
        else:
            new_headers.append((name, value))
    if not found:
        # No content-length header — leave scope as-is. The ASGI
        # contract lets servers send only ``more_body=False`` to mark
        # body end, which is exactly what ``_replay_receive`` does.
        return scope
    new_scope = dict(scope)
    new_scope["headers"] = new_headers
    return new_scope


__all__ = [
    "MultimodalContentNormalizerMiddleware",
    "normalize_messages_for_autogen",
]
