"""Vision-capable Agno agent for the Multimodal Attachments demo.

Wave 2b design: a dedicated vision-capable agent scoped to `/demos/multimodal`
so other demos keep their cheaper text-only model. Backed by ``gpt-4o`` so
attached images are read natively. PDFs are flattened to text on the
Python side via ``pypdf`` before the message is forwarded to the model.

Wire format
-----------
Attachments arrive here after travelling through:

  CopilotChat  →  AG-UI message content parts (image / document)
              →  Agno AGUI converter (extracts data URLs)
              →  this agent

CopilotChat emits modern multimodal parts (`{ type: "image", source: { ... }}`,
`{ type: "document", source: { ... }}`). The Agno AGUI router preserves
the structured attachment payload via its tool/converter machinery; we
inspect each user message and rewrite document parts (PDFs) into inline
text before invoking the model.
"""

from __future__ import annotations

import base64
import io
from typing import Any

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from dotenv import load_dotenv

load_dotenv()


SYSTEM_PROMPT = (
    "You are a helpful assistant. The user may attach images or documents "
    "(PDFs). When they do, analyze the attachment carefully and answer the "
    "user's question. If no attachment is present, answer the text question "
    "normally. Keep responses concise (1-3 sentences) unless asked to go deep."
)


def _extract_data_url_parts(url: str) -> tuple[str, str]:
    """Split a ``data:<mime>;base64,<payload>`` URL into (mime, payload)."""
    if not url.startswith("data:"):
        return "", url
    header, _, payload = url.partition(",")
    if ":" not in header:
        return "", payload
    meta = header.split(":", 1)[1]
    mime = meta.split(";", 1)[0] if ";" in meta else meta
    return mime, payload


def _extract_pdf_text(b64: str) -> str:
    """Decode an inline-base64 PDF and extract its text. Returns "" on error."""
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


def _maybe_flatten_pdf_part(part: Any) -> Any:
    """Flatten a PDF document content part into a plain text part."""
    if not isinstance(part, dict):
        return part

    part_type = part.get("type")

    if part_type == "document":
        source = part.get("source") or {}
        if not isinstance(source, dict):
            return part
        if source.get("type") != "data":
            return part
        mime = source.get("mimeType") or ""
        value = source.get("value")
        if not isinstance(value, str) or not isinstance(mime, str):
            return part
        if "pdf" not in mime.lower():
            return part
        text = _extract_pdf_text(value)
        if not text:
            return {
                "type": "text",
                "text": "[Attached document: PDF could not be read.]",
            }
        return {"type": "text", "text": f"[Attached document]\n{text}"}

    if part_type == "image_url":
        # Pass-through — gpt-4o reads image_url parts natively.
        return part

    return part


# Vision-capable model. gpt-4o consumes image content parts natively.
agent = Agent(
    model=OpenAIChat(id="gpt-4o", timeout=120),
    tools=[],
    description=SYSTEM_PROMPT,
)


__all__ = ["agent", "_maybe_flatten_pdf_part"]
