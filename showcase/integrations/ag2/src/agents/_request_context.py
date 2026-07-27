"""Per-request context capture for AG2 showcase backends.

Problem
-------
The AG2 showcase backends construct a single module-level
``ConversableAgent`` and re-use it across every inbound request (see
``agents/agent.py`` and ``agents/a2ui_dynamic.py``). Autogen mutates the
agent's ``chat_messages`` dict in place per turn, which means reading
"the latest user message" off ``agent.chat_messages`` is a cross-request
data race under any concurrency: a second request landing while the
first is still mid-tool-call observes the first request's messages.

The R2-A3 fix-cycle resolves this by reading the latest user prompt
directly from the per-request ``RunAgentInput.messages`` payload (the
runtime-supplied per-request body) instead of from autogen's shared
``chat_messages`` state. This module captures that payload at the HTTP
request boundary and exposes it via a ``contextvars.ContextVar`` so deep
tool-handler code (e.g. ``generate_a2ui``) can read it without threading
parameters through autogen's internal driver.

Mechanics
---------
1. ``RequestUserMessageMiddleware`` (Starlette/FastAPI ``BaseHTTPMiddleware``)
   runs on every inbound POST. It reads the body (Starlette caches the
   body internally so downstream handlers still see it), parses
   ``RunAgentInput.messages`` from the JSON payload, walks the list in
   chronological order, and stores the most recent ``role == "user"``
   message text in a per-request ``ContextVar``.
2. ``get_latest_user_message()`` returns the captured text (or ``""``).

Failures are intentionally NON-fatal: any parse error (non-JSON body,
missing ``messages``, schema drift, etc.) is logged at WARNING with the
exception type/message, and the ContextVar is set to ``""`` so callers
fall back to their hardcoded default. This is the R2-A2 fix discipline:
visibility into the fallback path rather than silent swallowing.
"""

from __future__ import annotations

import contextvars
import json
import logging
from typing import Any, Optional

from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)


_latest_user_message: contextvars.ContextVar[str] = contextvars.ContextVar(
    "ag2_latest_user_message",
    default="",
)


def get_latest_user_message() -> str:
    """Return the latest user message text captured for the current request.

    Returns ``""`` when no message was captured (non-AG-UI request, parse
    failure, empty ``messages`` array, an actually-empty user message,
    etc.) — callers should treat the empty string as "fall back to the
    hardcoded default prompt". The distinction between "user message
    present but empty" and "no user message in payload" is preserved at
    the ``_extract_latest_user_text`` boundary via ``Optional[str]`` but
    collapsed at the ContextVar boundary since downstream callers all
    fall back the same way.
    """
    return _latest_user_message.get()


def _extract_latest_user_text(payload: Any) -> Optional[str]:
    """Walk a parsed ``RunAgentInput``-shaped dict for the last user message.

    Iterates ``payload["messages"]`` in chronological order (the AG-UI
    contract: the runtime sends the conversation history in order) and
    returns the ``content`` of the last entry whose ``role == "user"``.

    Return semantics:
        * ``None``  — no user message present in the payload at all
          (non-dict payload, missing/empty ``messages`` list, no entry
          with ``role == "user"``, or every user entry had an
          unrecognised content shape).
        * ``""``    — a user message IS present but its content is the
          empty string (legitimate empty turn from the runtime).
        * non-empty ``str`` — the actual latest user text.

    Distinguishing ``None`` from ``""`` lets the caller decide whether
    to log "missing" vs "present but empty"; collapsing them at this
    boundary would force a guess. Schema-drift early-returns log at
    WARNING here (rather than via the caller wrapping in try/except)
    because no exception is raised — there's nothing for the caller to
    catch.
    """
    if not isinstance(payload, dict):
        logger.warning(
            "[ag2:request-context] payload is not a dict (got %s); "
            "no user message extractable",
            type(payload).__name__,
        )
        return None
    messages = payload.get("messages")
    if not isinstance(messages, list):
        logger.warning(
            "[ag2:request-context] payload.messages missing or not a list "
            "(got %s); no user message extractable",
            type(messages).__name__,
        )
        return None

    latest: Optional[str] = None
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str):
            # Present-but-empty is a legitimate value; set unconditionally
            # so the caller can distinguish "" (empty turn) from None
            # (no user message at all).
            latest = content
        elif isinstance(content, list):
            # Multimodal content: join the text parts, mirroring the
            # coercion in reasoning_agent._coerce_content. An empty
            # parts list collapses to "" — still "present but empty".
            parts: list[str] = []
            for part in content:
                if isinstance(part, dict):
                    text = part.get("text")
                elif hasattr(part, "text"):
                    text = getattr(part, "text", None)
                else:
                    text = None
                if isinstance(text, str):
                    parts.append(text)
            latest = "".join(parts)
        # Unknown content shapes (None, int, …) leave ``latest`` untouched
        # so a later well-formed user message still wins.

    if latest is None:
        logger.warning(
            "[ag2:request-context] no user message found in payload "
            "(messages len=%d); leaving latest-user-message empty",
            len(messages),
        )
    elif latest == "":
        logger.warning("[ag2:request-context] latest user message is present but empty")
    return latest


class RequestUserMessageMiddleware:
    """Capture the latest user message from each inbound ``RunAgentInput`` POST.

    Implemented as a raw ASGI middleware (NOT
    ``starlette.middleware.base.BaseHTTPMiddleware``) so we can buffer the
    inbound request body and replay it to the downstream ASGI app via a
    wrapped ``receive`` callable. ``BaseHTTPMiddleware`` does not re-emit
    consumed body chunks to the inner app, which would silently truncate
    the request to autogen / AG-UI.

    For POST requests with a JSON-ish body, parses ``RunAgentInput.messages``
    and stores the chronologically last ``role == "user"`` message in a
    per-request ContextVar. Non-POST requests and non-HTTP scopes pass
    through untouched. Parse failures are logged at WARNING (R2-A2
    visibility) and leave the ContextVar at its empty-string default.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # R5-A2: Unconditionally reset the ContextVar at __call__ entry,
        # BEFORE any branching by scope type or method. Autogen's
        # ``install_executor_contextvar_propagation`` makes
        # ``ThreadPoolExecutor`` workers inherit the dispatching request's
        # Context, and those workers are reused across requests. Without
        # this reset, a non-POST request, an empty-body POST, or any path
        # that doesn't reach the body-parse ``.set(...)`` below would
        # inherit whatever value the worker's prior request left in the
        # ContextVar — leaking the previous request's prompt into this
        # one. The body-parse path further down overrides this default
        # when a real user message is parsed.
        _latest_user_message.set("")

        if scope["type"] != "http" or scope.get("method") != "POST":
            await self.app(scope, receive, send)
            return

        # Buffer the entire request body so we can both inspect it AND
        # replay it to the inner ASGI app via a wrapped ``receive``.
        body_chunks: list[bytes] = []
        more_body = True
        client_disconnected = False
        while more_body:
            message = await receive()
            if message["type"] == "http.request":
                body_chunks.append(message.get("body", b"") or b"")
                more_body = bool(message.get("more_body", False))
            elif message["type"] == "http.disconnect":
                # Client hung up before the body fully arrived. Do NOT
                # invoke the downstream app with a truncated body: that
                # would feed autogen / AG-UI half a JSON document and
                # surface as a confusing parse error in the agent rather
                # than the actual root cause. Short-circuit instead and
                # log so the truncation is visible in the operator
                # dashboard.
                client_disconnected = True
                more_body = False
            else:
                # Unknown message kind for an HTTP scope — pass it
                # through unchanged and stop buffering.
                more_body = False

        raw = b"".join(body_chunks)

        if client_disconnected:
            logger.warning(
                "[ag2:request-context] client disconnected before request "
                "body fully received (%d bytes buffered); short-circuiting "
                "without invoking downstream app",
                len(raw),
            )
            return

        if raw:
            # NOTE: ``_extract_latest_user_text`` itself does NOT raise
            # on shape violations — it logs at WARNING and returns
            # ``None``. The try/except here is strictly for decoding
            # failures (``json.loads`` / UTF-8). A previous version
            # wrapped a broader ``(AttributeError, KeyError, TypeError)``
            # branch around the extractor call, but the extractor never
            # raises those — so the branch was dead code that hid the
            # real source of any shape-drift signal. The extractor now
            # owns its own logging on those paths.
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError as exc:
                logger.warning(
                    "[ag2:request-context] body is not valid JSON; "
                    "leaving latest-user-message empty: %s",
                    exc,
                )
                _latest_user_message.set("")
            except UnicodeDecodeError as exc:
                # ``json.loads`` accepts ``bytes`` and decodes them as
                # UTF-8 internally; a non-UTF-8 payload (rare but
                # possible from a misbehaving client) raises
                # ``UnicodeDecodeError`` rather than ``JSONDecodeError``.
                # Without this branch the exception escapes and crashes
                # the request silently from the operator's perspective.
                logger.warning(
                    "[ag2:request-context] body is not valid UTF-8; "
                    "leaving latest-user-message empty: %s",
                    exc,
                    exc_info=True,
                )
                _latest_user_message.set("")
            else:
                text = _extract_latest_user_text(payload)
                # Collapse None → "" at the ContextVar boundary: callers
                # all fall back to the hardcoded default the same way,
                # so the present-but-empty vs missing distinction has
                # already done its job via the extractor's WARNING logs.
                _latest_user_message.set(text if text is not None else "")

        replayed = False
        original_receive = receive

        async def _replay_receive() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {
                    "type": "http.request",
                    "body": raw,
                    "more_body": False,
                }
            # R7-A1: After the buffered body is delivered once, the inner
            # app may keep calling ``receive()`` for the lifetime of the
            # response — SSE / AG-UI streams in particular poll
            # ``receive()`` (via Starlette's ``listen_for_disconnect``) to
            # detect client disconnect. Per the ASGI spec, ANY
            # ``http.disconnect`` message terminates the response stream:
            # an earlier revision synthesised a single disconnect
            # immediately after body drain and that one synthesised
            # message was enough to cancel the SSE response prematurely.
            # The correct behaviour is to NEVER synthesise disconnect
            # post-drain and instead await ``original_receive()``, which
            # uvicorn blocks on until the REAL client ``http.disconnect``
            # arrives. That is precisely the long-poll semantics SSE /
            # AG-UI streams require.
            message = await original_receive()
            # Defensive: uvicorn should not deliver further
            # ``http.request`` messages after the body is drained (the
            # buffering loop above consumed every chunk until
            # ``more_body=False``), but the ASGI spec is not strictly
            # enforced by every server. Log and continue awaiting so the
            # inner app only ever observes ``http.disconnect`` (or other
            # legitimate post-body messages) on this code path.
            while message.get("type") == "http.request":
                logger.warning(
                    "[ag2:request-context] unexpected http.request after "
                    "body drain (more_body=%s, body_len=%d); ignoring and "
                    "awaiting real disconnect",
                    message.get("more_body"),
                    len(message.get("body", b"") or b""),
                )
                message = await original_receive()
            return message

        await self.app(scope, _replay_receive, send)
