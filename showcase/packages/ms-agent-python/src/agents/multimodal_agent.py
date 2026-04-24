"""
Multimodal MS Agent Framework agent -- accepts image + document (PDF)
attachments.

A *dedicated* vision-capable agent scoped to the `/demos/multimodal` cell.
Other demos continue to use their own (cheaper, text-only) models via
`agents/agent.py` -- this keeps vision cost isolated to the one demo that
exercises it.

Inputs the runtime may forward:
- `{"type": "text", "text": "..."}`
- `{"type": "image", "source": {"type": "data", "value": "<base64>",
    "mimeType": "image/png"}}`
- `{"type": "document", "source": {"type": "data", "value": "<base64>",
    "mimeType": "application/pdf"}}`

OpenAI's gpt-4o-mini handles `image` content parts natively. PDF handling is
less uniform across frameworks, so we pre-process `document` parts on the
Python side: extract text with `pypdf` and replace the document part with a
text part prefixed by `[Attached document]`. Images are passed through as-is.

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


def _extract_pdf_text(b64: str) -> str:
    """Decode an inline-base64 PDF and extract its text.

    Returns an empty string if decoding or extraction fails -- callers must
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
        return part
    mime_type = source.get("mimeType", "")
    if "pdf" not in mime_type.lower():
        return part
    value = source.get("value", "")
    text = _extract_pdf_text(value) if isinstance(value, str) else ""
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
