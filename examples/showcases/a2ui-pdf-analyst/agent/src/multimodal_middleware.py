"""Make CopilotChat's native PDF attachments actually work.

## The bug we're fixing

`ag_ui_langgraph.utils.convert_agui_multimodal_to_langchain` routes ALL
multimodal content. images, audio, video, AND documents. through
LangChain's `image_url` block, because that's the only media block LangChain
exposes. It builds a data URL like::

    data:text/plain;base64,<source.value>

For images this works (OpenAI knows what `data:image/png;base64,...` is).
For documents it doesn't:

  - `source.value` is our raw PDF text. NOT base64. so the data URL is
    malformed.
  - Even if it were valid base64, OpenAI's `image_url` parser won't accept
    a `text/plain` mime type. The request 400s and the agent run dies with
    `INCOMPLETE_STREAM`.

## The fix

We monkey-patch `convert_agui_multimodal_to_langchain` to intercept
`DocumentInputContent` parts with text-shaped mime types BEFORE the broken
conversion runs. We inline them as plain `text` blocks (with a short
``[Document: <filename>]`` header) so the model sees normal text and the
rest of the multimodal pipeline keeps working for real images.

Call ``install()`` once at agent startup. It's idempotent.
"""
from __future__ import annotations

from typing import Any, List

from ag_ui.core import (
    AudioInputContent,
    BinaryInputContent,
    DocumentInputContent,
    ImageInputContent,
    InputContentDataSource,
    TextInputContent,
    VideoInputContent,
)
from ag_ui_langgraph import utils as _utils

_TEXT_MIME_PREFIXES = (
    "text/",
    "application/json",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
)

_INSTALLED = False


def _is_text_mime(mime: str | None) -> bool:
    if not mime:
        return False
    return any(mime.startswith(p) for p in _TEXT_MIME_PREFIXES)


def _patched(content: List[Any]) -> List[dict]:
    out: List[dict] = []
    passthrough: List[Any] = []

    def _flush_passthrough() -> None:
        if passthrough:
            out.extend(_original(passthrough))
            passthrough.clear()

    for item in content:
        # Only DocumentInputContent with a text-shaped data source needs
        # rewriting. Everything else (images, video, audio, URL-sourced docs,
        # text items, binary) defers to the original converter.
        is_text_document = (
            isinstance(item, DocumentInputContent)
            and isinstance(item.source, InputContentDataSource)
            and _is_text_mime(item.source.mime_type)
        )
        if not is_text_document:
            passthrough.append(item)
            continue

        _flush_passthrough()
        filename = None
        if getattr(item, "metadata", None):
            try:
                filename = item.metadata.get("filename")  # type: ignore[attr-defined]
            except AttributeError:
                filename = None
        header = f"[Document: {filename}]\n" if filename else "[Document attached]\n"
        out.append({"type": "text", "text": header + item.source.value})

    _flush_passthrough()
    return out


_original = _utils.convert_agui_multimodal_to_langchain


def install() -> None:
    """Patch the ag-ui-langgraph multimodal converter. Safe to call repeatedly."""
    global _INSTALLED
    if _INSTALLED:
        return
    _utils.convert_agui_multimodal_to_langchain = _patched
    _INSTALLED = True


__all__ = ["install"]
