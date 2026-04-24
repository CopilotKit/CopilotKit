"""Multimodal LangGraph agent — accepts image + document (PDF) attachments.

Wave 2b design: a *dedicated* vision-capable graph scoped to the
`/demos/multimodal` cell. Other demos continue to use their own (cheaper,
text-only) models — this keeps vision cost isolated to the one demo that
exercises it.

Inputs the runtime may forward:
- `{"type": "text", "text": "..."}`
- `{"type": "image", "source": {"type": "data", "value": "<base64>",
    "mimeType": "image/png"}}`
- `{"type": "document", "source": {"type": "data", "value": "<base64>",
    "mimeType": "application/pdf"}}`

OpenAI's chat API natively handles `image` content parts via gpt-4o. PDF
handling is less uniform — LangChain's OpenAI integration does not yet map
`document` content parts to OpenAI's `input_file` parts consistently
across versions. To keep behavior deterministic and provider-agnostic, we
preprocess `document` parts on the server via an `AgentMiddleware`:
extract text with `pypdf` and replace the document part with a text part
prefixed by `[Attached document]`. Images are passed through as-is.

References:
- src/agents/main.py, src/agents/agentic_chat.py (baseline pattern)
- packages/runtime/src/agent/converters/tanstack.ts (content-part shape
  forwarded by the runtime)
"""

from __future__ import annotations

import base64
import io
from typing import Any

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

SYSTEM_PROMPT = (
    "You are a helpful assistant. The user may attach images or documents "
    "(PDFs). When they do, analyze the attachment carefully and answer the "
    "user's question. If no attachment is present, answer the text question "
    "normally. Keep responses concise (1-3 sentences) unless asked to go deep."
)

def _extract_pdf_text(b64: str) -> str:
    """Decode an inline-base64 PDF and extract its text.

    Returns an empty string if decoding or extraction fails — callers must
    treat the extracted text as best-effort. Any exception here is logged
    and swallowed so one malformed attachment does not tank the whole
    user turn.
    """
    # Strip a potential data URL prefix ("data:application/pdf;base64,...").
    if b64.startswith("data:"):
        _, _, b64 = b64.partition(",")
    try:
        raw = base64.b64decode(b64, validate=False)
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[multimodal_agent] base64 decode failed: {exc}")
        return ""

    try:
        # Lazy import — keeps the module importable even if pypdf is missing
        # at dev-server boot (we only need it when a PDF actually arrives).
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

def _preprocess_part(part: Any) -> Any:
    """Replace a `document` (PDF) part with an inline text block.

    Non-document parts are returned unchanged. Images pass through so
    gpt-4o can consume them natively.
    """
    if not isinstance(part, dict):
        return part
    if part.get("type") != "document":
        return part
    source = part.get("source") or {}
    if source.get("type") != "data":
        # URL-source documents are rare in this demo (we always inline base64).
        # Leave them alone; the model may or may not fetch the URL.
        return part
    mime_type = source.get("mimeType", "")
    if "pdf" not in mime_type.lower():
        # Non-PDF documents are unusual — pass through; nothing else we can do.
        return part
    value = source.get("value", "")
    text = _extract_pdf_text(value) if isinstance(value, str) else ""
    if not text:
        # Empty or unreadable PDF — give the model a structured note so it
        # can tell the user we couldn't read the document.
        return {
            "type": "text",
            "text": "[Attached document: PDF could not be read.]",
        }
    return {"type": "text", "text": f"[Attached document]\n{text}"}

def _rewrite_messages(messages: list[Any]) -> list[Any]:
    """Rewrite user messages so `document` parts become text parts.

    Operates on the messages list stored in agent state. Returns a *new*
    list; the input list is not mutated.
    """
    rewritten: list[Any] = []
    for message in messages:
        # Only touch HumanMessage — assistant/tool messages stay as-is.
        if not isinstance(message, HumanMessage):
            rewritten.append(message)
            continue
        content = message.content
        if not isinstance(content, list):
            rewritten.append(message)
            continue
        new_parts = [_preprocess_part(part) for part in content]
        rewritten.append(HumanMessage(content=new_parts, id=message.id))
    return rewritten

class _PdfFlattenMiddleware(AgentMiddleware):
    """Flatten `document` (PDF) content parts to text before the model call.

    We run this in `before_model` so every model invocation — including
    retries after tool calls — sees the flattened view. The middleware is
    idempotent: once a part has been rewritten to `{"type": "text", ...}`
    it is returned unchanged on subsequent passes.
    """

    def before_model(self, state, runtime):  # type: ignore[override]
        del runtime  # unused
        messages = state.get("messages") if isinstance(state, dict) else None
        if not messages:
            return None
        rewritten = _rewrite_messages(messages)
        # Only emit a patch if anything actually changed — avoids a
        # superfluous state update on every model hop.
        if rewritten == messages:
            return None
        return {"messages": rewritten}

# Vision-capable model. gpt-4o consumes `image` content parts natively.
_MODEL = ChatOpenAI(model="gpt-4o", temperature=0.2)

graph = create_agent(
    model=_MODEL,
    tools=[],
    middleware=[_PdfFlattenMiddleware(), CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)

# Re-export under both names — `graph` matches the langgraph.json convention
# used by the rest of the package; `multimodal_agent` is a friendlier alias
# for any future non-langgraph.json import paths.
multimodal_agent = graph

__all__ = ["graph", "multimodal_agent"]
