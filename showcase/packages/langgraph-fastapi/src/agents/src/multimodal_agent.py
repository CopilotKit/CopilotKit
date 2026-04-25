"""Multimodal LangGraph agent — accepts image + document (PDF) attachments.

Wave 2b design: a *dedicated* vision-capable graph scoped to the
`/demos/multimodal` cell. Other demos continue to use their own (cheaper,
text-only) models — this keeps vision cost isolated to the one demo that
exercises it.

Wire format the agent sees
==========================
Attachments arrive here after travelling through:

  CopilotChat  →  AG-UI message content parts  →  @ag-ui/langgraph runtime
                                                   (ag-ui → LangChain converter)
              →  this agent (LangChain HumanMessage content parts)

The ag-ui-langgraph converter only understands the legacy
``{ type: "binary", mimeType, data | url }`` AG-UI part shape — the page
at ``src/app/demos/multimodal/page.tsx`` installs an
``onRunInitialized`` shim that rewrites the modern
``{ type: "image" | "document", source: {...} }`` shape CopilotChat emits
to the legacy shape before it hits the runtime. Once the converter has
run, every attachment shows up in this agent as a LangChain
``image_url`` content part::

    {"type": "image_url", "image_url": {"url": "data:<mime>;base64,<payload>"}}

regardless of whether the upstream modality was ``image`` or ``document``.

We therefore route on ``mimeType``, not the part ``type``:
``image/*`` parts are forwarded to GPT-4o unchanged (vision-native);
``application/pdf`` parts are flattened to inline text via ``pypdf`` so
the model can read them without needing file-part support.

References:
- src/agents/main.py, src/agents/agentic_chat.py (baseline pattern)
- packages/runtime/src/agent/converters/tanstack.ts (the modern content-
  part shape — useful context when the runtime gets upgraded and this
  agent can drop the pypdf flatten)
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


def _extract_data_url_parts(url: str) -> tuple[str, str]:
    """Split a ``data:<mime>;base64,<payload>`` URL into (mime, base64-payload).

    Returns ("", url) if the input is not a base64 data URL — callers can
    fall back to treating the url as a fetchable reference.
    """
    if not url.startswith("data:"):
        return "", url
    header, _, payload = url.partition(",")
    # Header looks like "data:application/pdf;base64" — take the piece
    # between the colon and the first semicolon.
    if ":" not in header:
        return "", payload
    meta = header.split(":", 1)[1]
    mime = meta.split(";", 1)[0] if ";" in meta else meta
    return mime, payload


def _extract_pdf_text(b64: str) -> str:
    """Decode an inline-base64 PDF and extract its text.

    Returns an empty string if decoding or extraction fails — callers must
    treat the extracted text as best-effort. Any exception here is logged
    and swallowed so one malformed attachment does not tank the whole
    user turn.
    """
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


def _classify_attachment_part(part: Any) -> tuple[str, str, str] | None:
    """Inspect a content part and return (kind, mime, base64_payload).

    ``kind`` is one of ``"image"``, ``"pdf"``, ``"other"``. Returns
    ``None`` if the part is not an attachment we recognise (plain text,
    unrelated dict, string, etc.).

    Handles the shapes we actually see in practice:

    - ``{"type": "image_url", "image_url": {"url": "data:..."}}``
      (what the ag-ui-langgraph converter emits for every attachment
      after the page rewrites to legacy ``binary``).
    - ``{"type": "image_url", "image_url": "data:..."}``
      (older LangChain/OpenAI shape where ``image_url`` is a raw string).
    - ``{"type": "document", "source": {"type": "data",
      "value": "<base64>", "mimeType": "application/pdf"}}``
      (modern AG-UI shape — preserved for forward-compat if the runtime
      ever starts forwarding modern parts directly).
    """
    if not isinstance(part, dict):
        return None
    part_type = part.get("type")

    if part_type == "image_url":
        image_url = part.get("image_url")
        url: str | None = None
        if isinstance(image_url, str):
            url = image_url
        elif isinstance(image_url, dict):
            raw_url = image_url.get("url")
            if isinstance(raw_url, str):
                url = raw_url
        if not url:
            return None
        mime, payload = _extract_data_url_parts(url)
        if not payload or not mime:
            return None
        if mime.startswith("image/"):
            return ("image", mime, payload)
        if "pdf" in mime.lower():
            return ("pdf", mime, payload)
        return ("other", mime, payload)

    if part_type == "document":
        source = part.get("source")
        if not isinstance(source, dict) or source.get("type") != "data":
            return None
        value = source.get("value")
        mime = source.get("mimeType", "")
        if not isinstance(value, str) or not isinstance(mime, str):
            return None
        if "pdf" in mime.lower():
            return ("pdf", mime, value)
        return ("other", mime, value)

    return None


def _preprocess_part(part: Any) -> Any:
    """Flatten PDF attachments to text; pass everything else through.

    Images stay as-is so GPT-4o consumes them natively via its vision
    adapter. PDFs (which gpt-4o cannot read directly) become a text part
    prefixed with ``[Attached document]`` and the extracted body. If
    extraction fails we emit a structured placeholder so the model can
    tell the user the document was unreadable instead of pretending no
    attachment was sent.
    """
    classified = _classify_attachment_part(part)
    if classified is None:
        return part
    kind, _mime, payload = classified
    if kind != "pdf":
        return part
    text = _extract_pdf_text(payload)
    if not text:
        return {
            "type": "text",
            "text": "[Attached document: PDF could not be read.]",
        }
    return {"type": "text", "text": f"[Attached document]\n{text}"}


def _rewrite_messages(messages: list[Any]) -> list[Any]:
    """Rewrite user messages so non-image attachments become text parts.

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
    """Flatten PDF content parts to text before the model call.

    We run this in ``before_model`` so every model invocation — including
    retries after tool calls — sees the flattened view. The middleware is
    idempotent: once a part has been rewritten to ``{"type": "text", ...}``
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


# Vision-capable model. gpt-4o consumes `image_url` content parts natively.
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
