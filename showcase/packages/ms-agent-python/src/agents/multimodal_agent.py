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

The deployed AG-UI adapter recognizes the legacy
``{ type: "binary", mimeType, data | url }`` AG-UI part shape. The page at
``src/app/demos/multimodal/page.tsx`` installs an ``onRunInitialized`` shim
that rewrites the modern ``{ type: "image" | "document", source: {...} }``
shape CopilotChat emits to the legacy ``binary`` shape before it hits the
runtime. We therefore route on ``mimeType``, not the part ``type``:

- ``image/*`` parts are forwarded to GPT-4o-mini unchanged (vision-native).
- ``application/pdf`` parts are flattened to inline text via ``pypdf`` so
  the model can read them without needing file-part support.

Reference:
- showcase/packages/langgraph-python/src/agents/multimodal_agent.py
"""

from __future__ import annotations

import base64
import io
from textwrap import dedent
from typing import Any

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

    Handles the shapes the MS-AF AG-UI adapter may surface:

    - ``{"type": "image_url", "image_url": {"url": "data:..."}}``
      (post-adapter, from the legacy-binary rewrite on the page).
    - ``{"type": "image_url", "image_url": "data:..."}`` (older shape).
    - ``{"type": "binary", "mimeType": "...", "data": "<base64>"}``
      (direct legacy binary).
    - ``{"type": "document", "source": {"type": "data",
      "value": "<base64>", "mimeType": "application/pdf"}}`` (modern AG-UI).
    - ``{"type": "image", "source": {...}}`` (modern AG-UI, for completeness).
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

    if part_type == "binary":
        mime = part.get("mimeType", "")
        data = part.get("data")
        if not isinstance(mime, str) or not isinstance(data, str):
            return None
        if mime.startswith("image/"):
            return ("image", mime, data)
        if "pdf" in mime.lower():
            return ("pdf", mime, data)
        return ("other", mime, data)

    if part_type in ("document", "image"):
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


class _MultimodalAgent(AgentFrameworkAgent):
    """Thin wrapper that pre-processes inbound messages before each run.

    We flatten `document` (PDF) content parts to text so the model can reason
    about them even when the underlying chat client does not accept the
    `document` content-part shape. Images are untouched.
    """

    def _flatten_messages(self, messages: Any) -> Any:
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

    async def run(self, *args: Any, **kwargs: Any) -> Any:  # type: ignore[override]
        # AG-UI may hand us messages via a positional or keyword argument;
        # normalize both shapes before delegating to the base implementation.
        if "messages" in kwargs:
            kwargs["messages"] = self._flatten_messages(kwargs["messages"])
        elif args and isinstance(args[0], list):
            args = (self._flatten_messages(args[0]), *args[1:])
        return await super().run(*args, **kwargs)


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
