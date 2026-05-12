"""
Multimodal MS Agent Framework agent — accepts image + document (PDF)
attachments.

A *dedicated* vision-capable agent scoped to the ``/demos/multimodal`` cell.
Other demos continue to use their own chat clients via ``agents/agent.py``.

Wire format
===========
Attachments arrive after travelling through:

    CopilotChat  ->  AG-UI message content parts
                ->  agent_framework_ag_ui (AG-UI -> AF adapter)
                ->  this agent
                ->  agent_framework_openai (AF -> OpenAI Responses API)

The installed ``agent_framework_ag_ui`` adapter parses the modern AG-UI
multimodal shape natively (``{type: "image" | "document",
source: {type, value | url, mimeType}}``) — see ``_message_adapters.py:266``.
The ``agent_framework_openai`` client then forwards image + PDF parts to
OpenAI as ``input_file`` / ``input_image`` content blocks — see
``_chat_client.py:1525``. ``gpt-5.2`` accepts both natively.

Why a (tiny) subclass remains
=============================
The OpenAI Responses ``input_file`` schema requires a ``filename`` field
alongside ``file_data``. CopilotChat sends the filename in ``part.metadata.
filename``, but the upstream AG-UI adapter (``_message_adapters.py``) does
not propagate metadata into the resulting ``Content`` object — so the
chat-client conversion has no filename to forward and OpenAI 400s with
"Missing required parameter: input[1].content[1]" for any document.

We patch this with the smallest surgical override: walk inbound document
parts and copy ``metadata.filename`` to ``source.filename``, then patch
the adapter once at module load to also read ``source.filename`` into
``Content.additional_properties["filename"]``. No PDF extraction, no
shape rewriting, no provider-specific logic — just the one missing field.

Reference:
- showcase/integrations/langgraph-python/src/agents/multimodal_agent.py
"""

from textwrap import dedent
from typing import Any

from agent_framework import Agent, BaseChatClient, Content
from agent_framework_ag_ui import AgentFrameworkAgent

# Patch the upstream adapter ONCE at module import: when parsing a
# multimodal data part, propagate ``source.filename`` (or top-level
# ``part.filename``) into ``Content.additional_properties["filename"]``
# so the OpenAI chat-client conversion at ``_chat_client.py:1554`` finds
# it and includes it in the ``input_file`` payload.
import agent_framework_ag_ui._message_adapters as _ag_ui_adapters

_original_parse_multimodal_media_part = _ag_ui_adapters._parse_multimodal_media_part


def _parse_multimodal_media_part_with_filename(part: dict[str, Any]) -> Content | None:
    content = _original_parse_multimodal_media_part(part)
    if content is None:
        return None
    source = part.get("source") if isinstance(part, dict) else None
    filename = (
        (source.get("filename") if isinstance(source, dict) else None)
        or (part.get("filename") if isinstance(part, dict) else None)
        or (
            part.get("metadata", {}).get("filename")
            if isinstance(part, dict) and isinstance(part.get("metadata"), dict)
            else None
        )
    )
    if isinstance(filename, str) and filename:
        props = dict(content.additional_properties or {})
        props.setdefault("filename", filename)
        content.additional_properties = props
    return content


_ag_ui_adapters._parse_multimodal_media_part = _parse_multimodal_media_part_with_filename


SYSTEM_PROMPT = dedent(
    """
    You are a helpful assistant. The user may attach images or documents
    (PDFs). When they do, analyze the attachment carefully and answer the
    user's question. If no attachment is present, answer the text question
    normally. Keep responses concise (1-3 sentences) unless asked to go deep.
    """
).strip()


class _MultimodalAgent(AgentFrameworkAgent):
    """Promote ``metadata.filename`` to ``source.filename`` on inbound document
    parts so the patched adapter (above) can carry it into ``Content``."""

    async def run(self, input_data: dict[str, Any]):  # type: ignore[override]
        messages = input_data.get("messages")
        if isinstance(messages, list):
            for message in messages:
                if not isinstance(message, dict):
                    continue
                content = message.get("content")
                if not isinstance(content, list):
                    continue
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    if part.get("type") not in ("document", "binary"):
                        continue
                    metadata = part.get("metadata") or {}
                    filename = metadata.get("filename") if isinstance(metadata, dict) else None
                    if not isinstance(filename, str) or not filename:
                        continue
                    source = part.get("source")
                    if isinstance(source, dict) and "filename" not in source:
                        source["filename"] = filename
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
