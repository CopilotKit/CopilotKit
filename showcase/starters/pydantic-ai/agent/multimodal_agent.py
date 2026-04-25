"""Multimodal PydanticAI agent — accepts image + document (PDF) attachments.

Ports showcase/packages/langgraph-python/src/agents/multimodal_agent.py to
PydanticAI. The vision-capable model (`gpt-4o`) is scoped to this agent
only so other demos keep their cheaper text-only models.

Wire format the agent sees
==========================
Attachments arrive here after travelling through:

  CopilotChat  →  AG-UI message content parts  →  PydanticAI AG-UI bridge
              →  this agent (PydanticAI messages)

The frontend page at ``src/app/demos/multimodal/page.tsx`` installs the
same ``onRunInitialized`` shim used in the langgraph-python reference:
modern ``{ type: "image" | "document", source: {...} }`` parts get
rewritten to the legacy ``{ type: "binary", mimeType, data | url }``
shape before the request reaches the runtime. This keeps the on-wire
format compatible with AG-UI bridges that only understand the legacy
shape.

On the Python side we use a ``history_processor`` to preprocess user
messages before each model call:

- ``image/*`` legacy-binary parts are converted to PydanticAI's
  ``ImageUrl`` content (which ``OpenAIResponsesModel`` forwards as a
  vision-native ``image_url`` part to GPT-4o).
- ``application/pdf`` legacy-binary parts are flattened to inline text
  via ``pypdf`` so the model can read them without needing file-part
  support — matching the langgraph-python behaviour exactly.
- Any other part shape passes through unchanged.
"""

from __future__ import annotations

import base64
import io
from textwrap import dedent
from typing import Any

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIResponsesModel

SYSTEM_PROMPT = dedent(
    """
    You are a helpful assistant. The user may attach images or documents
    (PDFs). When they do, analyze the attachment carefully and answer the
    user's question. If no attachment is present, answer the text
    question normally. Keep responses concise (1-3 sentences) unless
    asked to go deep.
    """
).strip()

def _extract_pdf_text(b64: str) -> str:
    """Decode an inline-base64 PDF and extract its text.

    Returns an empty string if decoding or extraction fails — callers
    must treat the extracted text as best-effort. Any exception here is
    logged and swallowed so one malformed attachment does not tank the
    whole user turn.
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

def _classify_binary_part(part: Any) -> tuple[str, str, str] | None:
    """Inspect an AG-UI content part and return ``(kind, mime, payload)``.

    ``kind`` is one of ``"image"``, ``"pdf"``, ``"other"``. Returns
    ``None`` if the part is not an attachment we recognise.

    Handles both shapes that can arrive at the agent:

    - Legacy binary: ``{"type": "binary", "mimeType": "...",
      "data": "<base64>"}`` or ``"url": "..."``.
    - Modern source: ``{"type": "image" | "document",
      "source": {"type": "data", "value": "<base64>", "mimeType": "..."}}``.
    """
    if not isinstance(part, dict):
        return None
    part_type = part.get("type")

    if part_type == "binary":
        mime = part.get("mimeType") or ""
        data = part.get("data")
        if isinstance(data, str) and mime:
            if mime.startswith("image/"):
                return ("image", mime, data)
            if "pdf" in mime.lower():
                return ("pdf", mime, data)
            return ("other", mime, data)

    if part_type in ("image", "document"):
        source = part.get("source")
        if isinstance(source, dict) and source.get("type") == "data":
            value = source.get("value")
            mime = source.get("mimeType", "")
            if isinstance(value, str) and isinstance(mime, str) and mime:
                if mime.startswith("image/"):
                    return ("image", mime, value)
                if "pdf" in mime.lower():
                    return ("pdf", mime, value)
                return ("other", mime, value)

    return None

def _rewrite_part_for_model(part: Any) -> Any:
    """Rewrite a single content part into a model-friendly shape.

    - Image binary parts → OpenAI-style ``image_url`` dict with a
      ``data:`` URL embedded. ``OpenAIResponsesModel`` passes this
      through natively, matching GPT-4o's vision input format.
    - PDF binary parts → text part prefixed with ``[Attached document]``
      and the extracted body; falls back to a structured placeholder if
      extraction failed.
    - Everything else → unchanged.
    """
    classified = _classify_binary_part(part)
    if classified is None:
        return part
    kind, mime, payload = classified
    if kind == "image":
        return {
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{payload}"},
        }
    if kind == "pdf":
        text = _extract_pdf_text(payload)
        if not text:
            return {
                "type": "text",
                "text": "[Attached document: PDF could not be read.]",
            }
        return {"type": "text", "text": f"[Attached document]\n{text}"}
    # Unrecognized mime — stringify metadata so the model can at least
    # tell the user what was attached.
    return {
        "type": "text",
        "text": f"[Attached file of type {mime}]",
    }

def _rewrite_message_content(content: Any) -> Any:
    """Rewrite the ``content`` field of a single message.

    User messages carry lists of content parts; we walk the list and
    rewrite any binary/image/document parts in place. String-only
    content (assistant replies, system prompts) passes through.
    """
    if not isinstance(content, list):
        return content
    return [_rewrite_part_for_model(part) for part in content]

def _rewrite_history(messages: list[Any]) -> list[Any]:
    """History processor: flatten attachments before each model call.

    Receives the PydanticAI ``ModelMessage`` list. Only ``request``
    (user) messages carry attachments in practice; we defensively walk
    every message and rewrite any ``content`` field that is a list of
    parts. Idempotent: re-running on the already-rewritten list is a
    no-op.
    """
    rewritten: list[Any] = []
    for message in messages:
        # PydanticAI message objects expose parts on ``.parts``; each
        # part has a ``.content`` attribute (for UserPromptPart etc.).
        # We patch the ``.content`` in-place on a shallow copy rather
        # than constructing a new PydanticAI message, because PydanticAI
        # preserves message identity across runs for caching.
        parts = getattr(message, "parts", None)
        if not parts:
            rewritten.append(message)
            continue
        for part in parts:
            content = getattr(part, "content", None)
            if isinstance(content, list):
                new_content = _rewrite_message_content(content)
                if new_content is not content:
                    try:
                        part.content = new_content  # type: ignore[attr-defined]
                    except Exception:
                        # Immutable part — skip; preserves original
                        # behaviour without crashing the run.
                        pass
        rewritten.append(message)
    return rewritten

agent = Agent(
    model=OpenAIResponsesModel("gpt-4o"),
    system_prompt=SYSTEM_PROMPT,
    history_processors=[_rewrite_history],
)

__all__ = ["agent"]
