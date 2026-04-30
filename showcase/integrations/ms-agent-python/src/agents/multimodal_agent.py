"""
Multimodal MS Agent Framework agent -- accepts image + document (PDF)
attachments.

A *dedicated* vision-capable agent scoped to the `/demos/multimodal` cell.
Other demos continue to use their own (cheaper, text-only) models via
`agents/agent.py` -- this keeps vision cost isolated to the one demo that
exercises it.

Wire format the agent sees
==========================
Attachments arrive here after travelling through:

    CopilotChat  ->  AG-UI message content parts  ->  agent_framework_ag_ui
                                                       (AG-UI -> AF adapter)
                ->  this agent

CopilotChat emits the modern AG-UI multimodal content-part shape:

    {"type": "image", "source": {"type": "data", "value": "<base64>",
                                 "mimeType": "image/png"}}
    {"type": "document", "source": {"type": "data", "value": "<base64>",
                                    "mimeType": "application/pdf"}}

The MS-AF AG-UI adapter (>=1.0.0b260225) recognizes this shape directly
in ``_parse_multimodal_media_part`` and converts it to Agent Framework
``Content.from_uri`` / ``Content.from_data`` for the underlying chat
client. We pre-process the AG-UI dicts on the way in so PDFs are flattened
to text via ``pypdf`` (gpt-4o vision does not natively read PDFs).
Images pass through untouched and are forwarded to the model natively.

We also accept the legacy ``image_url`` shape some chat clients post-process
into, purely as a defensive fallback -- modern shape is canonical.

Reference:
- showcase/integrations/langgraph-python/src/agents/multimodal_agent.py
"""

from __future__ import annotations

import base64
import io
from textwrap import dedent
from typing import Any, AsyncGenerator

from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent


SYSTEM_PROMPT = dedent(
    """
    You are a helpful assistant. The user may attach images or documents
    (PDFs). When they do, analyze the attachment carefully and answer the
    user's question. If no attachment is present, answer the text question
    normally. Keep responses concise (1-3 sentences) unless asked to go deep.
    """
).strip()


def _extract_data_url_parts(url: str) -> tuple[str, str]:
    """Split a ``data:<mime>;base64,<payload>`` URL into (mime, base64-payload).

    Returns ("", url) if the input is not a data URL -- callers can fall
    back to treating the url as a fetchable reference.
    """
    if not url.startswith("data:"):
        return "", url
    header, _, payload = url.partition(",")
    if ":" not in header:
        return "", payload
    meta = header.split(":", 1)[1]
    mime = meta.split(";", 1)[0] if ";" in meta else meta
    return mime, payload


def _extract_pdf_text(b64: str) -> str:
    """Decode an inline-base64 PDF and extract its text.

    Returns an empty string if decoding or extraction fails -- callers must
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
        # Lazy import -- keeps the module importable even if pypdf is missing
        # at dev-server boot (we only need it when a PDF actually arrives).
        from pypdf import PdfReader  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - defensive
        print(
            "[multimodal_agent] pypdf not installed -- PDF text extraction "
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

    ``kind`` is one of ``"image"``, ``"pdf"``, ``"other"``. Returns ``None``
    if the part is not an attachment we recognize.

    Modern AG-UI shape (canonical, what CopilotChat emits):

    - ``{"type": "image", "source": {"type": "data",
      "value": "<base64>", "mimeType": "image/png"}}``
    - ``{"type": "document", "source": {"type": "data",
      "value": "<base64>", "mimeType": "application/pdf"}}``

    Legacy fallback (some chat clients post-process modern parts into a
    classic OpenAI-style ``image_url`` shape; we accept it defensively):

    - ``{"type": "image_url", "image_url": {"url": "data:..."}}``
    - ``{"type": "image_url", "image_url": "data:..."}``
    """
    if not isinstance(part, dict):
        return None
    part_type = part.get("type")

    # Modern AG-UI shape (canonical).
    if part_type in ("image", "document"):
        source = part.get("source")
        if not isinstance(source, dict) or source.get("type") != "data":
            return None
        value = source.get("value")
        mime = source.get("mimeType", "")
        if not isinstance(value, str) or not isinstance(mime, str):
            return None
        if mime.startswith("image/"):
            return ("image", mime, value)
        if "pdf" in mime.lower():
            return ("pdf", mime, value)
        return ("other", mime, value)

    # Defensive fallback: classic OpenAI-style image_url shape.
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

    return None


def _preprocess_part(part: Any) -> Any:
    """Flatten PDF attachments to text; pass everything else through.

    Images stay as-is so gpt-4o consumes them natively. PDFs become a text
    part prefixed with ``[Attached document]``. If extraction fails we emit
    a structured placeholder so the model can tell the user the document
    was unreadable rather than pretending no attachment was sent.
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


def _flatten_messages(messages: Any) -> Any:
    """Walk an AG-UI input ``messages`` list and rewrite PDF parts to text.

    Operates on the raw AG-UI dict representation (before the adapter
    converts to Agent Framework ``Message`` objects). Non-list / non-dict
    structures pass through unchanged.
    """
    if not isinstance(messages, list):
        return messages
    rewritten: list[Any] = []
    for message in messages:
        if not isinstance(message, dict):
            rewritten.append(message)
            continue
        content = message.get("content")
        if not isinstance(content, list):
            rewritten.append(message)
            continue
        new_parts = [_preprocess_part(part) for part in content]
        rewritten.append({**message, "content": new_parts})
    return rewritten


class _MultimodalAgent(AgentFrameworkAgent):
    """Pre-processes inbound AG-UI messages before each run.

    PDF (``document``) content parts are flattened to text so the model can
    reason about them even when the underlying chat client does not accept
    document content natively (gpt-4o vision reads images but not PDFs).
    Image parts are untouched and forwarded to the model via the MS-AF
    adapter's modern multimodal pipeline.
    """

    async def run(self, input_data: dict[str, Any]) -> AsyncGenerator[Any, None]:  # type: ignore[override]
        rewritten_messages = _flatten_messages(input_data.get("messages"))
        if rewritten_messages is not input_data.get("messages"):
            input_data = {**input_data, "messages": rewritten_messages}
        async for event in super().run(input_data):
            yield event


def create_multimodal_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the vision-capable multimodal demo agent."""
    base_agent = Agent(
        client=chat_client,
        name="multimodal_agent",
        instructions=SYSTEM_PROMPT,
        tools=[],
    )

    return _MultimodalAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkMultimodalAgent",
        description=(
            "Vision-capable agent that answers questions about attached "
            "images and PDFs."
        ),
        require_confirmation=False,
    )
