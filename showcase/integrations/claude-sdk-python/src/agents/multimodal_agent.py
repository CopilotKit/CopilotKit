"""Multimodal Claude agent — accepts image + document (PDF) attachments.

Scoped to the ``/demos/multimodal`` cell so other demos keep their cheaper
text-only model defaults.

Wire format the agent sees
==========================
Attachments arrive here after travelling through:

  CopilotChat  →  AG-UI message content parts  →  /api/copilotkit-multimodal
              →  HttpAgent (this Python backend)

Claude's Messages API supports image content parts natively (``{ "type":
"image", "source": {...} }``). The AG-UI message content parts use the
modern ``{ type: "image" | "document", source: { type: "data" | "url",
value, mimeType } }`` shape (what CopilotChat emits today). We convert
each attachment in-process:

- ``image/*`` parts become Claude image blocks (base64 inline), forwarded
  to the vision-capable model unchanged.
- ``application/pdf`` parts are flattened to text via ``pypdf`` and sent
  as a ``text`` block prefixed with ``[Attached document]``. Claude
  recent models also support PDFs natively as ``document`` blocks, but
  ``pypdf`` keeps the demo provider-agnostic and avoids counting against
  PDF beta access.
- Anything else falls through as-is.

References:
- packages/runtime/src/agent/converters/tanstack.ts (modern AG-UI parts)
- langgraph-python multimodal_agent.py (baseline pattern; the legacy
  ``binary`` shim is not needed here because HttpAgent forwards modern
  parts through without rewriting them).
"""

from __future__ import annotations

import base64
import io
from typing import Any

from dotenv import load_dotenv

load_dotenv()


SYSTEM_PROMPT = (
    "You are a helpful assistant. The user may attach images or documents "
    "(PDFs). When they do, analyze the attachment carefully and answer the "
    "user's question. If no attachment is present, answer the text question "
    "normally. Keep responses concise (1-3 sentences) unless asked to go deep."
)


def _extract_pdf_text(b64_payload: str) -> str:
    """Decode an inline-base64 PDF and extract its text.

    Returns an empty string if decoding or extraction fails — callers must
    treat the extracted text as best-effort. Any exception here is logged
    and swallowed so one malformed attachment does not tank the whole
    user turn.
    """
    try:
        raw = base64.b64decode(b64_payload, validate=False)
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[multimodal_agent] base64 decode failed: {exc}")
        return ""

    try:
        # Lazy import — keep the module importable even when pypdf is
        # missing; only needed when a PDF actually arrives.
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


def _source_to_base64(source: dict[str, Any]) -> str | None:
    """Pull base64 bytes out of an AG-UI ``source`` field.

    Supports both ``{type: "data", value: "<base64>"}`` and
    ``{type: "url", value: "data:...;base64,..."}`` shapes. Returns
    ``None`` for network URLs — Claude's native image block supports
    remote URLs, but PDFs must be inlined for ``pypdf``.
    """
    src_type = source.get("type")
    value = source.get("value")
    if not isinstance(value, str):
        return None
    if src_type == "data":
        return value
    if src_type == "url":
        if value.startswith("data:"):
            _, _, payload = value.partition(",")
            return payload
    return None


def convert_part_for_claude(part: Any) -> Any:
    """Translate an AG-UI content part into the Claude Messages API shape.

    Pass-through for parts we don't recognise — Claude will ignore or
    reject unknown shapes, which is better than silently dropping an
    attachment the user actually sent.
    """
    if isinstance(part, str):
        return {"type": "text", "text": part}

    if not isinstance(part, dict):
        return part

    part_type = part.get("type")

    if part_type == "text":
        return {"type": "text", "text": part.get("text", "")}

    # Modern AG-UI image part → Claude image block (base64 inline).
    if part_type == "image":
        source = part.get("source") or {}
        mime = source.get("mimeType") or "image/png"
        b64 = _source_to_base64(source)
        if b64:
            return {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime,
                    "data": b64,
                },
            }
        url_value = source.get("value")
        if isinstance(url_value, str) and url_value.startswith("http"):
            return {
                "type": "image",
                "source": {"type": "url", "url": url_value},
            }
        return {"type": "text", "text": "[Attached image could not be decoded.]"}

    # Modern AG-UI document part → flatten PDFs to text for a
    # provider-agnostic demo. Non-PDF documents become a placeholder so
    # the model can tell the user the attachment was unsupported.
    if part_type == "document":
        source = part.get("source") or {}
        mime = (source.get("mimeType") or "").lower()
        b64 = _source_to_base64(source)
        if "pdf" in mime and b64:
            text = _extract_pdf_text(b64)
            if text:
                return {"type": "text", "text": f"[Attached document]\n{text}"}
            return {
                "type": "text",
                "text": "[Attached document: PDF could not be read.]",
            }
        return {
            "type": "text",
            "text": f"[Attached document: unsupported type {mime or 'unknown'}.]",
        }

    # Legacy ``binary`` shape (defensive: if any adapter in the chain
    # still rewrites to it, handle it here instead of dropping).
    if part_type == "binary":
        mime = (part.get("mimeType") or "").lower()
        data = part.get("data")
        if isinstance(data, str) and mime.startswith("image/"):
            return {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime,
                    "data": data,
                },
            }
        if isinstance(data, str) and "pdf" in mime:
            text = _extract_pdf_text(data)
            if text:
                return {"type": "text", "text": f"[Attached document]\n{text}"}
            return {
                "type": "text",
                "text": "[Attached document: PDF could not be read.]",
            }
        return part

    return part


__all__ = ["SYSTEM_PROMPT", "convert_part_for_claude"]
