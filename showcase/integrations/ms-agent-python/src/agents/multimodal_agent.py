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
- showcase/integrations/langgraph-python/src/agents/multimodal_agent.py
"""

import base64
import copy
import io
from textwrap import dedent
from typing import Any

from agent_framework import (
    Agent,
    BaseChatClient,
    ChatContext,
    ChatMiddleware,
    Content,
)
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


def _content_pdf_payload(content: Content) -> tuple[str, str] | None:
    """If a Content holds an inline PDF, return ``(base64_payload, mime_type)``.

    Returns ``None`` for any other content type, including PDFs delivered via
    ``ag-ui://binary/<id>`` or external HTTPS URLs — those cannot be inlined
    without a separate fetch and are left for the chat client to handle.
    """
    media_type = (content.media_type or "").lower()
    if "pdf" not in media_type:
        return None
    uri = content.uri or ""
    if not uri.startswith("data:"):
        return None
    _, _, payload = uri.partition(",")
    if not payload:
        return None
    return payload, media_type or "application/pdf"


def _flattened_pdf_block(payload: str) -> str:
    """Render one inline PDF payload as the text block the model reads."""
    text = _extract_pdf_text(payload)
    if text:
        return f"[Attached document]\n{text}"
    return "[Attached document]\n(unable to extract text)"


def _last_text_index(contents: list[Content]) -> int | None:
    """Index of the last text content in ``contents``, or ``None`` if there is none."""
    for index in range(len(contents) - 1, -1, -1):
        content = contents[index]
        if content.type == "text" and content.text is not None:
            return index
    return None


def _merge_text_into(content: Content, suffix: str) -> Content:
    """Return a *copy* of ``content`` with ``suffix`` appended to its text.

    Copying rather than mutating is load-bearing: ``_PdfFlattenChatMiddleware``
    restores the message's original ``contents`` list after the model call, and
    that restore only undoes the *list* swap. Mutating a ``Content`` the
    original list still references would leak the flattened PDF body into the
    AG-UI ``MESSAGES_SNAPSHOT`` and render a wall of raw PDF text in the user's
    chat bubble.
    """
    merged = copy.copy(content)
    merged.text = f"{content.text}\n{suffix}"
    return merged


class _PdfFlattenChatMiddleware(ChatMiddleware):
    """Flatten inline PDF content parts to text for the model call only.

    Scoping the rewrite to ``ChatMiddleware.process`` (LGP's equivalent of
    ``wrap_model_call``) is what keeps the flattened ``[Attached document]\\n``
    dump from leaking back into the AG-UI ``MESSAGES_SNAPSHOT``: the agent's
    canonical message state stays intact, the chat client sees the text-only
    version, and the user's chat bubble keeps showing the original PDF chip
    instead of the raw PDF body.

    Originally the multimodal agent mutated ``input_data["messages"]`` inside
    an ``AgentFrameworkAgent.run`` override, but that mutation flows into the
    outbound snapshot serializer (``agent_framework_ag_ui._message_adapters
    ._normalize_snapshot_content``) which then bleeds the flattened text into
    every subsequent chat-bubble render. Restoring the original ``contents``
    after ``call_next`` is the discipline that prevents that bleed.

    Why the flattened text is MERGED into the prompt content
    -------------------------------------------------------
    The flattened document must land *inside* the message's existing prompt
    text content, not alongside it as a second text content, because
    ``agent_framework_openai`` emits **one OpenAI message per ``Content``**:
    ``_chat_completion_client._prepare_message_for_openai`` builds a fresh
    ``args`` dict on every loop iteration, so a user ``Message`` carrying
    ``[prompt_text, flattened_doc_text]`` serialises to *two consecutive user
    messages* -- prompt-only, then document-only.

    That splits one logical user turn in two and makes the document, not the
    question, the final user message. Anything that reads "the current user
    turn" from the tail of the message list then sees only
    ``[Attached document]\\n...`` with the question nowhere in it. Observed
    verbatim: aimock's strict mode answered the PDF turn with
    ``503 no_fixture_match`` because its last-user-turn text was the document
    body (aimock already skips *text-less* trailing user messages, which is why
    the image turn -- whose trailing split-off message has no text -- matched
    fine). Against a real model the same shape degrades silently instead of
    erroring: the question is buried behind a document dump.

    Merging keeps the turn as a single text content, so it serialises to a
    single user message reading ``"<prompt>\\n[Attached document]\\n<body>"``.
    ``langgraph-python``'s equivalent agent is green precisely because
    LangChain keeps multiple text parts inside one message instead of splitting
    them.
    """

    async def process(
        self,
        context: ChatContext,
        call_next: Any,
    ) -> None:
        messages = context.messages or []
        snapshots: list[tuple[Any, list[Content] | None]] = []
        for message in messages:
            contents = getattr(message, "contents", None)
            if not contents:
                continue
            rewritten: list[Content] = []
            blocks: list[str] = []
            for content in contents:
                pdf = _content_pdf_payload(content)
                if pdf is None:
                    rewritten.append(content)
                    continue
                payload, _ = pdf
                block = _flattened_pdf_block(payload)
                # The page's ``LegacyConverterShim`` APPENDS a legacy
                # ``binary`` mirror alongside every modern attachment part
                # (see src/app/demos/multimodal/legacy-converter-shim.tsx), so
                # the same PDF reaches this middleware twice. Emit its body
                # once -- sending it twice doubles prompt tokens for nothing.
                if block not in blocks:
                    blocks.append(block)
            if not blocks:
                continue

            anchor = _last_text_index(rewritten)
            flattened = "\n".join(blocks)
            if anchor is None:
                # Attachment-only turn: nothing to merge into, so the
                # flattened document stands alone as the message body.
                rewritten.append(Content.from_text(text=flattened))
            else:
                rewritten[anchor] = _merge_text_into(rewritten[anchor], flattened)

            snapshots.append((message, list(contents)))
            message.contents = rewritten  # type: ignore[attr-defined]

        try:
            await call_next()
        finally:
            for message, original in snapshots:
                message.contents = original  # type: ignore[attr-defined]


def create_multimodal_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the vision-capable multimodal demo agent."""
    base_agent = Agent(
        client=chat_client,
        name="multimodal_agent",
        instructions=SYSTEM_PROMPT,
        tools=[],
        middleware=[_PdfFlattenChatMiddleware()],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkMultimodalAgent",
        description=(
            "Vision-capable agent that answers questions about attached "
            "images and PDFs."
        ),
        require_confirmation=False,
    )
