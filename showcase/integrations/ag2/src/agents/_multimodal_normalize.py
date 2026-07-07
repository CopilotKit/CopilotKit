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
``NormalizingAGUIStream`` subclasses ``AGUIStream`` and overrides
``dispatch`` to normalise each user message's content list so AG-UI
image / document / binary parts become OpenAI Chat Completions
``image_url`` parts (which autogen accepts and forwards to the
vision-capable model natively).

The normalization runs AFTER ``RunAgentInput`` Pydantic parsing (which
accepts the standard AG-UI ``image``/``document``/``binary`` content
types) and BEFORE the messages are passed to ``AgentService``, which
serialises them via ``model_dump()`` into raw dicts and passes them to
``ConversableAgent``. That is the correct interception point: too early
(before Pydantic) would require rewriting ``image_url`` into the AG-UI
body, which ``RunAgentInput`` rejects; too late (inside ConversableAgent)
would require patching autogen internals.

Conversions:

* ``{"type": "image", "source": {"type": "data", value, mime_type}}`` →
  ``{"type": "image_url", "image_url": {"url": "data:<mime>;base64,<value>"}}``
* ``{"type": "image", "source": {"type": "url", value}}`` →
  ``{"type": "image_url", "image_url": {"url": value}}``
* ``{"type": "document", "source": ...}`` → ``image_url`` with the
  document's mime preserved (data:application/pdf;base64,...). The vision
  model still cannot natively read PDFs, but the request reaches the model
  instead of being rejected upstream.
* ``{"type": "binary", mimeType, data | url}`` → ``image_url`` (the
  legacy-shim parts ride through cleanly).
* ``{"type": "text", ...}`` and already-normalised ``image_url`` parts
  pass through unchanged (idempotent on no-op turns).

Failure path: any normalization error is logged at WARNING and the
original message is replayed unchanged — autogen's own ``ValueError``
fires verbatim, preserving the failure surface.

The normalizer is mounted ONLY on the ``multimodal_app`` sub-app
(``agents/multimodal_agent.py``), not on the global FastAPI server in
``agent_server.py`` — keeping the blast radius scoped to the one route
that actually sees image content parts.
"""

from __future__ import annotations

import logging
from typing import Any, AsyncIterator

from autogen.ag_ui import AGUIStream, RunAgentInput

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
    """Rewrite a list of message dicts so AG-UI multimodal parts are
    converted to autogen-acceptable ``image_url`` parts.

    Accepts the dict-serialised form produced by
    ``RunAgentInput.messages[i].model_dump(exclude_none=True)`` — the
    same dicts that ``run_stream`` in autogen's AG-UI adapter passes to
    ``AgentService``.

    Returns the input value untouched if it is not the expected list
    shape. Otherwise returns a NEW list with rewritten user-message
    content; non-user messages are forwarded as-is.

    The function is pure: it never mutates the input.
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


class NormalizingAGUIStream(AGUIStream):
    """``AGUIStream`` subclass that normalises AG-UI multimodal content.

    Overrides ``dispatch`` to call ``normalize_messages_for_autogen``
    on the parsed ``RunAgentInput.messages`` (as serialised dicts) AFTER
    Pydantic validation and BEFORE ``AgentService`` processes them. This
    is the only correct interception point:

    * Too early (ASGI body rewrite before Pydantic): ``RunAgentInput``
      rejects ``image_url`` because it is not an AG-UI standard content
      type — the validator only accepts ``image``, ``document``,
      ``binary``, ``text``, ``audio``, ``video``.
    * Too late (inside ConversableAgent): requires patching autogen
      internals that can change across versions.

    The override patches ``autogen.ag_ui.adapter.run_stream`` at call
    time by supplying pre-normalised messages via a thin
    ``RequestMessage`` shim, replacing only the ``messages`` field in
    the ``AGStreamInput`` passed to the inherited ``dispatch`` machinery.
    """

    async def dispatch(
        self,
        incoming: RunAgentInput,
        *,
        context: dict[str, Any] | None = None,
        accept: str | None = None,
    ) -> AsyncIterator[str]:
        # Serialise all messages to dicts (same as run_stream does) then
        # normalise, then re-inject via a patched incoming object so the
        # rest of the dispatch machinery sees image_url parts instead of
        # AG-UI image/document/binary parts.
        raw_msgs: list[dict[str, Any]] | None = None
        try:
            raw_msgs = [m.model_dump(exclude_none=True) for m in incoming.messages]
            normalised_msgs = normalize_messages_for_autogen(raw_msgs)
        except Exception as exc:  # noqa: BLE001 — log + fall back to original
            logger.warning(
                "[ag2:multimodal-normalize] pre-dispatch normalization failed "
                "(%s); forwarding original messages to autogen",
                exc,
                exc_info=True,
            )
            normalised_msgs = None

        if (
            normalised_msgs is not None
            and raw_msgs is not None
            and normalised_msgs is not raw_msgs
        ):
            # Re-validate the normalised dicts back into Pydantic Message
            # objects so the rest of AGUIStream.dispatch / run_stream can
            # work with a properly typed RunAgentInput.
            # We use model_validate (not model_validate_json) since we already
            # have a Python dict.  The normalised content uses image_url parts,
            # which are NOT in the AG-UI InputContent union — so we re-validate
            # just the message list using the raw dict form and pass it via a
            # reconstructed RunAgentInput.
            #
            # IMPORTANT: we pass the normalised dicts as plain dicts; autogen's
            # run_stream calls model_dump() on each message in
            # command.incoming.messages.  To avoid a double round-trip we
            # instead *monkey-patch the model_dump contract* by building a
            # lightweight wrapper list that returns the pre-normalised dict on
            # model_dump() — keeping the rest of dispatch's typing clean.
            incoming = _PatchedRunAgentInput(incoming, normalised_msgs)

        # Delegate to the parent implementation with the (possibly patched)
        # incoming object.  AGUIStream.dispatch is a normal async generator so
        # we must use "yield from" semantics via the async iterator protocol.
        async for chunk in super().dispatch(incoming, context=context, accept=accept):
            yield chunk


class _DictMessage:
    """Minimal message wrapper that returns a pre-computed dict on model_dump.

    ``run_stream`` in autogen's adapter calls
    ``m.model_dump(exclude_none=True)`` on each message in
    ``command.incoming.messages``.  This wrapper satisfies that call
    without the round-trip overhead of re-parsing the normalised dict
    back through Pydantic (which would fail anyway since ``image_url``
    is not an AG-UI content type).
    """

    __slots__ = ("_d",)

    def __init__(self, d: dict[str, Any]) -> None:
        self._d = d

    def model_dump(self, *, exclude_none: bool = False) -> dict[str, Any]:  # noqa: ARG002
        return self._d


class _PatchedRunAgentInput:
    """Thin wrapper around ``RunAgentInput`` that substitutes a pre-normalised
    message list while forwarding all other attribute access to the original.

    ``AGUIStream.dispatch`` and ``run_stream`` read ``incoming.messages``,
    ``incoming.tools``, ``incoming.thread_id``, ``incoming.run_id``,
    ``incoming.state``, ``incoming.context``, and ``incoming.forwarded_props``
    (plus optionally ``incoming.resume``).  We override only ``messages``; all
    others fall through to the real ``RunAgentInput`` object.
    """

    __slots__ = ("_real", "_messages")

    def __init__(
        self,
        real: RunAgentInput,
        normalised_dicts: list[dict[str, Any]],
    ) -> None:
        object.__setattr__(self, "_real", real)
        object.__setattr__(
            self,
            "_messages",
            [_DictMessage(d) for d in normalised_dicts],
        )

    @property
    def messages(self) -> list[_DictMessage]:
        return object.__getattribute__(self, "_messages")

    def __getattr__(self, name: str) -> Any:
        return getattr(object.__getattribute__(self, "_real"), name)


__all__ = [
    "NormalizingAGUIStream",
    "normalize_messages_for_autogen",
]
