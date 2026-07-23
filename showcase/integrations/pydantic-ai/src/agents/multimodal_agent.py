"""Multimodal PydanticAI agent — accepts image + document (PDF) attachments.

Ports showcase/integrations/langgraph-python/src/agents/multimodal_agent.py to
PydanticAI. The vision-capable model (`gpt-4o`) is scoped to this agent
only so other demos keep their cheaper text-only models.

Wire format the agent sees
==========================
Attachments arrive here after travelling through:

  CopilotChat  →  AG-UI message content parts  →  PydanticAI AG-UI bridge
              →  this agent (PydanticAI messages)

CopilotChat emits modern ``{ type: "image" | "document", source: {...} }``
parts; the frontend page may additionally rewrite them to the legacy
``{ type: "binary", mimeType, data | url }`` shape. The PydanticAI AG-UI
bridge (``pydantic_ai.ag_ui._messages_from_ag_ui``) drops the raw
``UserMessage.content`` list — a list of AG-UI ``InputContent`` *model
objects* (``TextInputContent``, ``ImageInputContent``,
``DocumentInputContent``, ``BinaryInputContent`` …) — straight into
``UserPromptPart.content`` with NO conversion. PydanticAI's own
``OpenAIResponsesModel._map_user_prompt`` then ``assert_never``s on those
AG-UI objects because they are not native PydanticAI content types.

So we normalise EVERY AG-UI content subtype — for BOTH ``data`` (inline
base64) and ``url`` sources — into the native PydanticAI content types
``OpenAIResponsesModel._map_user_prompt`` understands:

- ``text`` → plain ``str``.
- ``image`` (data, SUPPORTED subtype) → :class:`pydantic_ai.ImageUrl`
  wrapping a ``data:`` URI. OpenAI's Responses vision API accepts ONLY
  PNG/JPEG/GIF/WebP (see :data:`_OPENAI_SUPPORTED_IMAGE_SUBTYPES`), so only
  those subtypes are emitted as an ``ImageUrl``; the Responses model forwards
  it verbatim as a vision-native ``input_image`` part. (``ImageUrl`` with a
  ``data:`` URI and ``BinaryContent`` both deliver inline base64 images
  identically through ``_map_user_prompt``; we use ``ImageUrl`` to match the
  langgraph-python reference's data-URI delivery.)
- ``image`` (data, UNSUPPORTED subtype — ``image/heic`` (the iPhone default!),
  ``image/svg+xml``, ``image/tiff``, ``image/bmp`` …) → degraded to a
  descriptive text placeholder (``[Attached image: <mime>]``): the Responses
  API would REJECT the unsupported subtype (dropping the image / failing the
  turn), so we degrade exactly like audio/video rather than emit it.
- ``image`` (url) → :class:`pydantic_ai.ImageUrl` wrapping the http(s)
  URL when the subtype is supported (or the mime is absent — no ``data:`` URI
  is built); an UNSUPPORTED present subtype degrades to a placeholder just
  like the data path, since the provider rejects it regardless of delivery.
- ``document``/PDF (data) → flattened to inline text via ``pypdf`` so the
  model can read it without needing file-part support — matching the
  langgraph-python behaviour exactly.
- ``document`` (url, PDF) → flattened to a reference placeholder (we
  cannot extract text from a URL without fetching it); a non-PDF
  ``document`` (url) carrying a fetchable-document mime →
  :class:`pydantic_ai.DocumentUrl`. A ``document``/``binary`` (url) carrying an
  audio/video/image or missing mime is NOT a fetchable document — it degrades
  to a text placeholder rather than an unconditional ``DocumentUrl`` the
  Responses mapper would reject.
- non-image/non-PDF ``binary``/``document`` (data) →
  :class:`pydantic_ai.BinaryContent` so the model still receives the file.
- A missing-mime *inline-DATA* image is sniffed for a SUPPORTED concrete image
  media type from its base64 magic bytes (ONLY PNG/JPEG/GIF/WebP are sniffed as
  positives — see :func:`_sniff_image_mime`). We must NEVER emit a
  ``data:image/*;base64`` URI — OpenAI's Responses API rejects the wildcard
  media type — NOR an unsupported concrete subtype (the sniffer no longer
  returns TIFF/BMP, since those would also be rejected). If the bytes are not a
  recognised SUPPORTED image format we degrade to a generic-attachment text
  placeholder (the langgraph-python reference DROPS such missing-mime parts).
- A *recoverable-empty* part (a known-modality ``binary`` with no data and no
  url, or a modern ``image``/``document`` with an empty/absent source) is
  degraded to a placeholder string rather than dropped or fail-louded — these
  are expected, recoverable conditions, not unknown shapes.
- A known-but-unsupported modality (``audio``/``video``) is degraded to a
  descriptive text placeholder (e.g. ``[Attached audio: <mime>]``): the OpenAI
  Responses mapper cannot consume audio/video as native content, but a
  recognised modality is NOT an unknown shape — it degrades, never fail-louds.

For a TRULY-unknown shape (an unrecognised ``type``, a non-content object) we
**fail loud** — raising a clear ``ValueError`` naming the shape — rather than
silently passing the object through to ``_map_user_prompt``'s ``assert_never``.

State safety (langgraph-python parity)
======================================
The langgraph-python reference scopes its flatten to the *model call* via
``wrap_model_call`` so the rewrite never persists back into agent state
(which would render the flattened PDF text / image substitutions verbatim
in the user's chat bubble).

PydanticAI's ``history_processors`` hook is NOT model-call-scoped for this
purpose: ``_agent_graph`` writes the processor's *returned* list straight
back to state with ``ctx.state.message_history[:] = message_history`` (see
``pydantic_ai._agent_graph`` around the ``_process_message_history`` call).
So a processor that *returns* flattened content leaks that flattened
PDF-text / ImageUrl into the UI-visible conversation state — keeping the
processor "pure" (new objects, originals untouched) protects the ORIGINALS
but NOT the returned list that gets persisted. (Empirically confirmed by
``test_model_boundary_flatten_does_not_persist_to_state``.)

We therefore scope the flatten to the *model boundary* — exactly mirroring
the reference's ``wrap_model_call`` contract — via a thin
:class:`pydantic_ai.models.wrapper.WrapperModel` subclass
(:class:`_MultimodalFlattenModel`) whose ``request`` / ``request_stream``
flatten the OUTGOING ``messages`` list just before delegating to the wrapped
``OpenAIResponsesModel``. The flatten never touches
``ctx.state.message_history``, so the persisted (UI-visible) conversation
keeps the original AG-UI content while only the provider request is
normalised. No content-flattening ``history_processor`` is registered.
"""

from __future__ import annotations

import base64
import dataclasses
import io
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from textwrap import dedent
from typing import Any

from pydantic_ai import Agent, BinaryContent, DocumentUrl, ImageUrl
from pydantic_ai._run_context import RunContext
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    UserPromptPart,
)
from pydantic_ai.models import ModelRequestParameters, StreamedResponse
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RequestUsage


SYSTEM_PROMPT = dedent(
    """
    You are a helpful assistant. The user may attach images or documents
    (PDFs). When they do, analyze the attachment carefully and answer the
    user's question. If no attachment is present, answer the text
    question normally. Keep responses concise (1-3 sentences) unless
    asked to go deep.
    """
).strip()

# Used when an attachment arrives without a usable mime type. The model
# still receives the bytes/URL so it can tell the user what was attached.
_DEFAULT_MIME = "application/octet-stream"

# The ONLY image subtypes OpenAI's Responses vision API accepts as an
# ``input_image`` part. Any other subtype (``image/heic`` — the iPhone
# default! — ``image/svg+xml``, ``image/tiff``, ``image/bmp`` …) is REJECTED
# by the provider, dropping the image / failing the turn. This is the single
# source of truth: an image whose subtype is in this set is emitted as an
# ``ImageUrl``; an image whose subtype is NOT in it degrades to a text
# placeholder (the same degrade pattern as audio/video). Applied to BOTH the
# present-mime path and the missing-mime sniff path so neither can ever emit an
# unsupported ``data:image/*`` URI. Subtypes are compared lower-cased.
_OPENAI_SUPPORTED_IMAGE_SUBTYPES = frozenset({"png", "jpeg", "gif", "webp"})


def _normalize_image_mime(mime: str) -> str:
    """Normalise an image media type for allow-list comparison.

    Strips RFC-2045 parameters (anything after ``;``) and surrounding
    whitespace, lower-cases, and aliases the non-canonical-but-ubiquitous
    ``image/jpg`` → ``image/jpeg`` so a real JPEG is not dropped. The result is
    a bare ``type/subtype`` (or the empty string for a blank input) suitable for
    both the ``image/`` prefix test and the subtype membership test. This is the
    single normalisation used everywhere a mime is compared to the allow-list.
    """
    low = mime.split(";", 1)[0].strip().lower()
    if low == "image/jpg":
        return "image/jpeg"
    return low


def _is_supported_image_mime(mime: str) -> bool:
    """Return ``True`` iff ``mime`` is an OpenAI-supported image media type.

    Accepts only ``image/<subtype>`` where ``<subtype>`` is one of the
    Responses-vision-supported formats (PNG/JPEG/GIF/WebP); a non-image mime or
    an unsupported image subtype (HEIC/SVG/TIFF/BMP …) returns ``False``. The
    mime is normalised first (parameters/whitespace stripped, ``image/jpg``
    aliased to ``image/jpeg``) so a supported image carrying a parameter or a
    non-canonical subtype is not wrongly degraded.
    """
    low = _normalize_image_mime(mime)
    if not low.startswith("image/"):
        return False
    subtype = low[len("image/") :]
    return subtype in _OPENAI_SUPPORTED_IMAGE_SUBTYPES


def _looks_like_fetchable_document(mime: str) -> bool:
    """Return ``True`` iff a ``url``-source ``other`` attachment may be emitted
    as a :class:`pydantic_ai.DocumentUrl` the model can fetch as a file part.

    The ``other`` branch is reached only for non-image, non-PDF mimes, so this
    gate excludes the modalities the OpenAI Responses file-part mapper cannot
    consume — audio, video, and (defensively) image — as well as a
    missing/blank/octet-stream mime, all of which degrade to a placeholder
    instead of an unconditional ``DocumentUrl`` the provider would reject. Any
    other present, concrete mime (text/*, application/* office docs, …) is
    treated as a fetchable document.
    """
    low = mime.split(";", 1)[0].strip().lower()
    if not low or low == _DEFAULT_MIME:
        return False
    if low.startswith(("audio/", "video/", "image/")):
        return False
    return True


def _extract_pdf_text(b64: str) -> str:
    """Decode an inline-base64 PDF and extract its text.

    Returns an empty string if decoding or extraction fails — callers
    must treat the extracted text as best-effort. A malformed *payload*
    is an expected, recoverable condition (one bad attachment must not
    tank the whole user turn), so it is logged and degraded to ``""``;
    this is NOT the fail-loud path, which is reserved for unknown
    *content shapes* in :func:`_rewrite_part_for_model`.
    """
    try:
        raw = base64.b64decode(b64, validate=False)
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[multimodal_agent] base64 decode failed: {exc}")
        return ""

    try:
        from pypdf import PdfReader  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - defensive
        print(
            "[multimodal_agent] pypdf not installed — PDF text extraction "
            f"unavailable: {exc}",
        )
        return ""

    try:
        reader = PdfReader(io.BytesIO(raw))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(pages).strip()
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[multimodal_agent] pypdf extraction failed: {exc}")
        return ""


def _part_to_dict(part: Any) -> Any:
    """Normalise an AG-UI content part to a plain ``dict``.

    AG-UI ``InputContent`` is a Pydantic model, so ``model_dump()`` gives
    us ``{"type": ..., "text"/"source": ...}`` with ``snake_case`` keys
    (e.g. ``mime_type``). Already-dict parts (legacy on-wire shape
    rewritten by the frontend shim) pass through unchanged. A non-model,
    non-dict part (e.g. a bare ``str`` already-native content) is returned
    as-is for the caller to classify.

    A ``model_dump()`` that *raises* is NOT swallowed: a mapping failure
    here would otherwise silently re-enable the downstream ``assert_never``,
    so we let it surface (fail-loud) — this is integration/AI-adjacent code.
    """
    if isinstance(part, dict):
        return part
    dump = getattr(part, "model_dump", None)
    if callable(dump):
        return dump()
    return part


def _source_payload(source: Any) -> tuple[str, str, str] | None:
    """Extract ``(scheme, value, mime)`` from an AG-UI content source dict.

    ``scheme`` is ``"data"`` (inline base64 in ``value``) or ``"url"``
    (a fetchable reference in ``value``). Handles both ``camelCase``
    (``mimeType``) and ``snake_case`` (``mime_type``) keys, since the
    source can arrive either from the frontend on-wire shape or from
    ``model_dump()`` of an AG-UI object. Returns ``None`` if the source
    is not a recognised ``data``/``url`` source with a string value.
    """
    if not isinstance(source, dict):
        return None
    scheme = source.get("type")
    if scheme not in ("data", "url"):
        return None
    value = source.get("value")
    if not isinstance(value, str) or not value:
        return None
    mime = source.get("mimeType") or source.get("mime_type") or ""
    if not isinstance(mime, str):
        mime = ""
    return (scheme, value, mime)


def _classify_content_part(part: Any) -> tuple[str, str, str, str] | None:
    """Inspect an AG-UI content part and return ``(kind, scheme, mime, value)``.

    ``kind`` is one of ``"image"``, ``"pdf"``, ``"other"``, or the special
    ``"empty"`` (a recognised-modality attachment carrying no usable
    data/url/source — a recoverable-empty case the caller degrades to a
    placeholder rather than fail-louding). ``scheme`` is ``"data"`` (``value``
    is inline base64) or ``"url"`` (``value`` is a fetchable URL); for
    ``"empty"`` both ``scheme`` and ``value`` are ``""``.

    Returns ``None`` ONLY if the part is not an attachment shape we recognise
    at all (plain text, already-native content, a genuinely unknown ``type``) —
    the caller fail-louds on that. A recognised-but-empty attachment is NOT
    ``None``; it is ``("empty", "", mime, "")``.

    Handles every shape that can arrive at the agent:

    - Legacy binary: ``{"type": "binary", "mimeType"/"mime_type": "...",
      "data": "<base64>"}`` (data scheme) or ``"url": "..."`` (url scheme).
    - Modern source: ``{"type": "image" | "document",
      "source": {"type": "data" | "url", "value": "...", "mimeType": "..."}}``.

    A part whose modality is recognised but whose mime is missing keeps an
    empty mime for an image (so the caller sniffs / degrades) and the canonical
    mime for a pdf, so it is never dropped.
    """
    part = _part_to_dict(part)
    if not isinstance(part, dict):
        return None
    part_type = part.get("type")

    if part_type == "binary":
        mime = part.get("mimeType") or part.get("mime_type") or ""
        if not isinstance(mime, str):
            mime = ""
        data = part.get("data")
        url = part.get("url")
        kind, mime = _kind_for(mime, default="other")
        if isinstance(data, str) and data:
            return (kind, "data", mime, data)
        if isinstance(url, str) and url:
            return (kind, "url", mime, url)
        # Known-modality binary with no data and no url: recoverable-empty.
        return ("empty", "", mime, "")

    if part_type in ("image", "document"):
        # The part type tells us the modality even when mime/source is absent.
        default_kind = "image" if part_type == "image" else "pdf"
        payload = _source_payload(part.get("source"))
        if payload is None:
            # Modern image/document with an empty/absent source:
            # recoverable-empty, not an unknown shape.
            return ("empty", "", "", "")
        scheme, value, mime = payload
        kind, mime = _kind_for(mime, default=default_kind)
        return (kind, scheme, mime, value)

    if part_type in ("audio", "video"):
        # Known AG-UI modalities the OpenAI Responses mapper cannot consume as
        # native vision/file content. Degrade to a text placeholder (consistent
        # with the other unsupported-binary degradation) rather than fail-loud:
        # a recognised modality is NOT an unknown shape. ``kind`` carries the
        # modality so the caller can build a descriptive placeholder; an
        # empty/absent source degrades just the same.
        payload = _source_payload(part.get("source"))
        mime = payload[2] if payload is not None else ""
        return (part_type, "", mime, "")

    return None


def _sniff_image_mime(raw: bytes) -> str | None:
    """Sniff an OpenAI-SUPPORTED image media type from a decoded byte payload.

    Returns a concrete ``image/<fmt>`` media type for the OpenAI-Responses-
    SUPPORTED web image formats ONLY (PNG/JPEG/GIF/WebP — see
    :data:`_OPENAI_SUPPORTED_IMAGE_SUBTYPES`), or ``None`` if the bytes are not
    a recognised SUPPORTED image. Formats OpenAI rejects (TIFF/BMP/HEIC/…) are
    deliberately NOT sniffed as positives: emitting a ``data:image/tiff`` URI
    would fail the turn, so an unsupported-format payload returns ``None`` here
    and the caller degrades it to a text placeholder — never an ``ImageUrl``.
    """
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return None


def _kind_for(mime: str, *, default: str) -> tuple[str, str]:
    """Map a mime type to a ``kind`` and the (possibly-empty) mime to use.

    Returns ``(kind, mime)``. When ``mime`` is present we route on it. When
    ``mime`` is MISSING we fall back to the modality the part ``type`` implied
    but DO NOT synthesise a fake concrete mime: an image returns ``("image",
    "")`` so the caller can sniff a concrete type from the bytes (never emit
    ``image/*``); a pdf gets the canonical ``application/pdf``; everything else
    is treated as a generic attachment.
    """
    if mime:
        low = mime.lower()
        if low.startswith("image/"):
            return ("image", mime)
        if "pdf" in low:
            return ("pdf", mime)
        return ("other", mime)
    # Missing mime — fall back on the modality the part type implied. For an
    # image we return an EMPTY mime (never "image/*") so the caller sniffs a
    # concrete media type from the payload or degrades to a placeholder.
    if default == "image":
        return ("image", "")
    if default == "pdf":
        return ("pdf", "application/pdf")
    return ("other", _DEFAULT_MIME)


def _text_of(part: Any) -> str | None:
    """Return the text of a text content part, or ``None``.

    Recognises the AG-UI ``TextInputContent`` model object and the
    equivalent ``{"type": "text", "text": "..."}`` dict. PydanticAI's
    ``_map_user_prompt`` only accepts a plain ``str`` for text content,
    so text parts must be flattened to ``str``.
    """
    part = _part_to_dict(part)
    if isinstance(part, dict) and part.get("type") == "text":
        text = part.get("text")
        if isinstance(text, str):
            return text
    return None


# Native PydanticAI content types that ``_map_user_prompt`` already maps.
# These pass through the rewrite untouched. Note the rewrite as a WHOLE is
# NOT a round-trip-idempotent transform — e.g. PDF (data) → extracted ``str``
# is a one-way flatten (the original PDF bytes are not recoverable). What this
# pass-through guarantees is only that re-applying the rewrite to its OWN
# already-native output is a stable fixpoint (a ``str``/``ImageUrl`` stays
# itself), so running the model-boundary flatten over partially-native content
# is safe.
_NATIVE_CONTENT = (str, ImageUrl, BinaryContent, DocumentUrl)


def _rewrite_part_for_model(part: Any) -> Any:
    """Rewrite a single content part into a native PydanticAI content type.

    ``OpenAIResponsesModel._map_user_prompt`` only maps the native content
    types (``str``, ``ImageUrl``, ``BinaryContent``, ``DocumentUrl`` …) and
    ``assert_never``s on anything else — including AG-UI ``InputContent``
    model objects *and* raw OpenAI-style dicts. So we always emit native
    types here, for BOTH inline-``data`` and ``url`` sources:

    - Text → plain ``str``.
    - Image (data, SUPPORTED subtype) → ``ImageUrl`` wrapping a
      ``data:<concrete-mime>`` URI. Only the OpenAI-supported subtypes
      (PNG/JPEG/GIF/WebP — :data:`_OPENAI_SUPPORTED_IMAGE_SUBTYPES`) are
      emitted; a missing mime is sniffed from the magic bytes (never
      ``image/*``, never an unsupported subtype), and an unsniffable payload
      degrades to a placeholder ``str``.
    - Image (data, UNSUPPORTED subtype — heic/svg/tiff/bmp/…) → degraded to a
      ``[Attached image: <mime>]`` placeholder ``str``: OpenAI's Responses API
      rejects the subtype, so emitting it would fail the turn (same degrade
      pattern as audio/video).
    - Image (url) → ``ImageUrl`` wrapping the URL when the subtype is supported
      or the mime is absent (no ``data:`` URI is built); an UNSUPPORTED present
      subtype degrades to a placeholder, since the provider rejects it
      regardless of data-vs-url delivery.
    - PDF (data) → ``str`` (extracted text, or a placeholder if unreadable).
    - PDF (url) → ``str`` reference placeholder (no fetch).
    - other (data) → ``BinaryContent`` so the model still gets the bytes; an
      unsupported image subtype (``binary.is_image`` true) and any
      non-image/non-document binary are logged and degraded to a placeholder
      ``str`` (the supported-type gate lives at this emission choke point).
    - other (url) → ``DocumentUrl`` ONLY for a fetchable-document mime; an
      audio/video/image or missing-mime url degrades to a placeholder ``str``
      rather than an unconditional ``DocumentUrl`` the mapper would reject.
    - A recoverable-empty attachment (``kind == "empty"``) → degraded to a
      placeholder ``str`` — NOT fail-louded.
    - A known-but-unsupported modality (``audio``/``video``) → degraded to a
      descriptive placeholder ``str`` (e.g. ``[Attached audio: audio/mpeg]``).
      The OpenAI Responses mapper cannot consume audio/video natively, but a
      recognised modality is NOT an unknown shape — it degrades, NOT fail-louds.
    - Already-native content (``str`` / ``ImageUrl`` / ``BinaryContent`` /
      ``DocumentUrl``) → unchanged (a stable fixpoint, so re-applying the
      flatten over its own output is safe; this is NOT a claim that the
      attachment→native transform round-trips).
    - A genuinely unknown shape (unrecognised ``type`` / non-content object) →
      **fail loud**: raise a ``ValueError`` naming the shape, NEVER silently
      pass it through to the downstream ``assert_never``.
    """
    # Already-native content (a stable fixpoint of the flatten) — leave as-is.
    if isinstance(part, _NATIVE_CONTENT):
        return part

    text = _text_of(part)
    if text is not None:
        return text

    classified = _classify_content_part(part)
    if classified is not None:
        kind, scheme, mime, value = classified
        if kind == "empty":
            # Recognised modality, but no usable data/url/source. Degrade to a
            # placeholder so one empty attachment doesn't tank the turn. Preserve
            # a KNOWN mime in the placeholder (consistent with the unsupported-
            # image and non-image-binary degrades) so the model can still tell
            # the user what was attached; only a truly-unknown mime is omitted.
            print(
                "[multimodal_agent] empty attachment "
                f"(mime={mime or 'unknown'!r}) — degraded to placeholder",
            )
            if mime:
                return f"[Attached file ({mime}) could not be read.]"
            return "[Attached file could not be read.]"
        if kind in ("audio", "video"):
            # Known-but-unsupported modality: the OpenAI Responses mapper cannot
            # consume audio/video as native content. Degrade to a descriptive
            # placeholder (consistent with the non-image/non-document binary
            # path) so the model can tell the user what was attached, rather
            # than fail-louding a recognised modality.
            print(
                f"[multimodal_agent] {kind} attachment "
                f"(mime={mime or 'unknown'!r}) — degraded to placeholder",
            )
            label = mime or kind
            return f"[Attached {kind}: {label}]"
        if kind == "image":
            if scheme == "data":
                concrete = mime
                if concrete:
                    # Present mime: only the OpenAI-supported subtypes
                    # (PNG/JPEG/GIF/WebP) may be emitted as an ImageUrl. An
                    # unsupported subtype (image/heic, image/svg+xml, …) would
                    # be REJECTED by the Responses API — degrade to a text
                    # placeholder (same pattern as audio/video) so the turn
                    # proceeds and the model can tell the user what was sent.
                    if not _is_supported_image_mime(concrete):
                        print(
                            "[multimodal_agent] unsupported image subtype "
                            f"(mime={concrete!r}) — degraded to placeholder",
                        )
                        return f"[Attached image: {concrete}]"
                    # Supported subtype — emit the NORMALISED canonical mime in
                    # the data URI (strips RFC-2045 params/whitespace; aliases
                    # image/jpg → image/jpeg) so OpenAI receives a clean,
                    # allow-listed media type rather than the raw header value.
                    concrete = _normalize_image_mime(concrete)
                else:
                    # Missing mime: NEVER emit "data:image/*" (OpenAI rejects
                    # the wildcard). Sniff a SUPPORTED concrete type from the
                    # bytes; an unsupported/unrecognised payload sniffs to
                    # ``None`` and degrades (the reference drops such parts).
                    try:
                        raw = base64.b64decode(value, validate=False)
                    except Exception as exc:
                        print(
                            "[multimodal_agent] missing-mime image base64 "
                            f"decode failed: {exc} — degraded to placeholder",
                        )
                        return "[Attached image could not be read.]"
                    sniffed = _sniff_image_mime(raw)
                    if sniffed is None:
                        print(
                            "[multimodal_agent] missing-mime image not a "
                            "supported format — degraded to placeholder",
                        )
                        return "[Attached image could not be read.]"
                    concrete = sniffed
                return ImageUrl(url=f"data:{concrete};base64,{value}")
            # URL-source image: an unsupported subtype is REJECTED by the
            # provider just the same, so apply the allow-list here too. A
            # missing mime on a URL source is harmless (no data: URI is built),
            # so an empty mime still passes through as an ImageUrl.
            if mime and not _is_supported_image_mime(mime):
                print(
                    "[multimodal_agent] unsupported image subtype "
                    f"(mime={mime!r}) — degraded to placeholder",
                )
                return f"[Attached image: {mime}]"
            return ImageUrl(url=value)
        if kind == "pdf":
            if scheme == "data":
                extracted = _extract_pdf_text(value)
                if not extracted:
                    return "[Attached document: PDF could not be read.]"
                return f"[Attached document]\n{extracted}"
            # URL-source PDF: we cannot extract text without fetching it;
            # hand the model a reference so it can tell the user.
            return f"[Attached document: {value}]"
        # Non-image / non-PDF attachment ("other"). This is the SINGLE native-
        # type EMISSION CHOKE POINT for BinaryContent / DocumentUrl, so the
        # supported-type gate + degrade live here (not per content-branch): no
        # unsupported image subtype and no audio/video/other-non-document mime
        # is ever emitted as a native type the OpenAI mapper would reject.
        if scheme == "data":
            try:
                raw = base64.b64decode(value, validate=False)
            except Exception as exc:
                raise ValueError(
                    f"multimodal_agent: failed to decode inline base64 for "
                    f"attachment of type {mime!r}: {exc}"
                ) from exc
            binary = BinaryContent(data=raw, media_type=mime or _DEFAULT_MIME)
            # CHOKE POINT: an image binary whose subtype is NOT in the allow-list
            # (HEIC/SVG/TIFF/BMP — ``binary.is_image`` is true for ANY image/*)
            # must degrade, NOT be emitted as a rejected image binary. This makes
            # the allow-list genuinely single-source regardless of how a part is
            # routed to the "other" branch.
            if binary.is_image and not _is_supported_image_mime(binary.media_type):
                print(
                    "[multimodal_agent] unsupported image binary "
                    f"(mime={binary.media_type!r}) — degraded to placeholder",
                )
                return f"[Attached image: {binary.media_type}]"
            # The OpenAI Responses model can only map image/document binary
            # content; for anything else (incl. a missing-mime octet-stream)
            # hand the model a descriptive string so it can tell the user
            # what was attached instead of crashing the mapper. Log the drop
            # so it stays triageable, consistent with the other degradations.
            if binary.is_image or binary.is_document:
                return binary
            print(
                "[multimodal_agent] non-image/non-document binary "
                f"(mime={mime or 'unknown'!r}) — degraded to placeholder",
            )
            return f"[Attached file of type {mime or 'unknown'}]"
        # URL-source "other": CHOKE POINT for DocumentUrl. Only emit a fetchable
        # DocumentUrl for a mime the Responses model can actually consume as a
        # file part (a real document); audio/video and other non-document mimes
        # (and an unsupported image subtype that somehow reached here) degrade to
        # a placeholder rather than an unconditional DocumentUrl the mapper /
        # provider would reject and fail the turn.
        if not _looks_like_fetchable_document(mime):
            print(
                "[multimodal_agent] non-document url attachment "
                f"(mime={mime or 'unknown'!r}) — degraded to placeholder",
            )
            return f"[Attached file of type {mime or 'unknown'}]"
        return DocumentUrl(url=value)

    # Genuinely unknown shape — fail loud rather than feed the downstream
    # ``assert_never``. Name the shape so the failure is triageable.
    shape = type(part).__name__
    preview = part if isinstance(part, dict) else repr(part)
    raise ValueError(
        "multimodal_agent: unrecognised content part of type "
        f"{shape!r} — cannot normalise to a native PydanticAI content type "
        f"(would crash OpenAIResponsesModel._map_user_prompt's assert_never). "
        f"Part: {preview!r}"
    )


def _rewrite_message_content(content: Any) -> Any:
    """Rewrite the ``content`` field of a single message.

    User messages carry lists of content parts; we walk the list and
    rewrite every part to a native PydanticAI content type. String-only
    content (assistant replies, system prompts) passes through.
    """
    if not isinstance(content, list):
        return content
    return [_rewrite_part_for_model(part) for part in content]


def _flatten_messages_for_model(messages: list[ModelMessage]) -> list[ModelMessage]:
    """Flatten AG-UI attachment content to native PydanticAI content types.

    Receives the PydanticAI ``ModelMessage`` list bound for the provider and
    returns a NEW list in which every ``UserPromptPart`` whose content is a
    list has had each part normalised to a native content type
    (``str`` / ``ImageUrl`` / ``BinaryContent`` / ``DocumentUrl``).

    This function is **pure**: it never mutates the incoming message or part
    objects. It is called at the MODEL BOUNDARY (see
    :class:`_MultimodalFlattenModel`), NOT as a ``history_processor`` — the
    history-processor hook persists its return to ``ctx.state.message_history``
    (the UI-visible conversation), which would leak the flattened PDF text /
    ImageUrl substitutions into the user's chat bubble. Scoping the flatten to
    the outgoing request mirrors the langgraph-python reference's
    ``wrap_model_call`` contract.

    A ``UserPromptPart`` whose rewrite is a no-op (content unchanged) is left
    as the ORIGINAL object — we never rebuild on a no-op. Only ``ModelRequest``
    messages carry user attachments; every other message kind passes through by
    reference unchanged.
    """
    rewritten: list[ModelMessage] = []
    for message in messages:
        if not isinstance(message, ModelRequest):
            rewritten.append(message)
            continue

        new_parts: list[Any] = []
        changed = False
        for part in message.parts:
            content = getattr(part, "content", None)
            if isinstance(part, UserPromptPart) and isinstance(content, list):
                new_content = _rewrite_message_content(content)
                # Detect a genuine no-op by IDENTITY, element-wise, not by
                # structural ``==``. The original list holds AG-UI ``InputContent``
                # model objects while a rewrite produces native types
                # (str/ImageUrl/BinaryContent/DocumentUrl); comparing those
                # heterogeneous pairs with ``==`` is fragile — a custom ``__eq__``
                # could raise on the hot model-boundary path, or a liberal
                # ``__eq__`` could false-positive and keep an un-flattened object
                # (re-enabling the downstream ``assert_never``). A real no-op
                # leaves every element the SAME object (a native fixpoint); a
                # flatten always builds new objects. ``is`` cannot raise and
                # cannot false-positive across an AG-UI→native conversion.
                if len(new_content) == len(content) and all(
                    n is o for n, o in zip(new_content, content)
                ):
                    # No-op rewrite — keep the original part object as-is.
                    new_parts.append(part)
                    continue
                # Field-complete copy: preserve every UserPromptPart field
                # (timestamp, part_kind, …) and only swap content.
                new_parts.append(dataclasses.replace(part, content=new_content))
                changed = True
            else:
                new_parts.append(part)

        if not changed:
            # Nothing in this request needed rewriting — keep it as-is.
            rewritten.append(message)
            continue

        rewritten.append(dataclasses.replace(message, parts=new_parts))
    return rewritten


class _MultimodalFlattenModel(WrapperModel):
    """Wraps a model to flatten AG-UI attachment content at the model boundary.

    The AG-UI bridge drops raw ``InputContent`` objects into
    ``UserPromptPart.content``; we normalise them to native PydanticAI content
    types in the OUTGOING request only, just before delegating to the wrapped
    model. Because this happens at the request boundary — not via a
    ``history_processor`` — the flatten never persists into
    ``ctx.state.message_history``, so the UI-visible conversation keeps the
    original AG-UI content (mirrors the langgraph-python ``wrap_model_call``).

    Every model-call path FLATTENS before delegating: ``request``
    (non-streaming), ``request_stream`` (streaming), AND ``count_tokens`` (the
    ahead-of-request token count ``_agent_graph`` runs when
    ``UsageLimits.count_tokens_before_request`` is set). The goal is uniform:
    no path ever feeds raw AG-UI content to the wrapped model's prompt mapper /
    ``assert_never``. (The ``count_tokens`` override flattens-then-delegates to
    keep that invariant; it does NOT make ahead-of-request token counting
    functional — the wrapped ``OpenAIResponsesModel`` raises
    ``NotImplementedError`` for it. See ``count_tokens`` below.)
    """

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        return await self.wrapped.request(
            _flatten_messages_for_model(messages),
            model_settings,
            model_request_parameters,
        )

    async def count_tokens(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> RequestUsage:
        """Flatten AG-UI content before delegating the token-count call.

        ``_agent_graph`` calls ``count_tokens(message_history, ...)`` with the
        UN-flattened history when ``UsageLimits.count_tokens_before_request`` is
        set, so the raw AG-UI ``InputContent`` objects would otherwise reach the
        wrapped model's prompt mapper (and its ``assert_never``) on this path —
        exactly the crash the ``request`` flatten guards against. We mirror
        ``request`` here so NO model-call path (request, stream, or token count)
        ever feeds raw AG-UI content to a prompt mapper. The flatten is pure, so
        (like ``request``) it never persists into ``ctx.state.message_history``.

        NOTE: this override does NOT make ahead-of-request token counting
        *work* — ``OpenAIResponsesModel`` (the wrapped model) does not support
        it and its ``count_tokens`` raises ``NotImplementedError``. The override's
        sole job is to guarantee no un-flattened AG-UI content reaches a prompt
        mapper IF this path is ever exercised; it does not enable the feature.
        """
        return await self.wrapped.count_tokens(
            _flatten_messages_for_model(messages),
            model_settings,
            model_request_parameters,
        )

    @asynccontextmanager
    async def request_stream(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
        run_context: RunContext[Any] | None = None,
    ) -> AsyncIterator[StreamedResponse]:
        async with self.wrapped.request_stream(
            _flatten_messages_for_model(messages),
            model_settings,
            model_request_parameters,
            run_context,
        ) as response_stream:
            yield response_stream


# Vision-capable model (``gpt-4o`` consumes image content natively), wrapped so
# the AG-UI attachment flatten is scoped to the model call and never persists
# into UI-visible state. (The gpt-4o vs gpt-5.4 choice mirrors the
# langgraph-python reference's intent but stays on gpt-4o here to keep the
# recorded aimock fixtures stable.)
agent = Agent(
    model=_MultimodalFlattenModel(OpenAIResponsesModel("gpt-4o")),
    system_prompt=SYSTEM_PROMPT,
)


__all__ = ["agent"]
