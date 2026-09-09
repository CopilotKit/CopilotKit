"""Red→green tests for the ms-agent-python multimodal PDF turn losing the prompt.

Exercises the REAL failure surface, not a fake: every assertion drives the real
``_PdfFlattenChatMiddleware`` and then the real
``agent_framework_openai.OpenAIChatCompletionClient._prepare_message_for_openai``
serialiser, and inspects the actual OpenAI wire payload that would go on the
network. The PDF is the actual bundled ``public/demo-files/sample.pdf`` run
through real ``pypdf``, and the prompt asserted on is read out of the actual
aimock fixture (``showcase/aimock/d6/ms-agent-python/multimodal.json``) rather
than hardcoded — so these tests fail if either side drifts.

The bug
-------
``agent_framework_openai`` emits **one OpenAI message per ``Content``** (it
builds a fresh ``args`` dict on every iteration of its content loop). The
middleware used to append the flattened ``[Attached document]\\n...`` text as a
*second* text ``Content`` next to the prompt, so one logical user turn
serialised to two consecutive user messages — prompt-only, then document-only.
The document, not the question, became the final user turn.

RED before the fix: ``test_pdf_turn_last_user_message_contains_the_prompt``
fails — the last outbound user message is the flattened document with the
question nowhere in it (this is what made aimock's strict mode answer the PDF
turn ``503 no_fixture_match``, and what would make a real model answer the
wrong question).
GREEN after: the flattened document is merged INTO the prompt's text content, so
the turn serialises to a single user message carrying both.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import pytest
from agent_framework import ChatContext, Content, Message
from agent_framework_openai import OpenAIChatCompletionClient

from agents.multimodal_agent import _PdfFlattenChatMiddleware


_INTEGRATION_ROOT = Path(__file__).resolve().parents[2]
_SHOWCASE_ROOT = _INTEGRATION_ROOT.parents[1]
_SAMPLE_PDF = _INTEGRATION_ROOT / "public" / "demo-files" / "sample.pdf"
_FIXTURE = _SHOWCASE_ROOT / "aimock" / "d6" / "ms-agent-python" / "multimodal.json"

DOC_MARKER = "[Attached document]"


def _pdf_prompt_from_fixture() -> str:
    """The PDF-turn prompt the aimock fixture keys on.

    Read from the fixture rather than hardcoded so this test tracks the real
    match key. aimock does a substring match against the last user turn, so
    "the outbound last user message contains this string" is exactly the
    condition the cell needs.
    """
    fixtures = json.loads(_FIXTURE.read_text())["fixtures"]
    prompts = [
        f["match"]["userMessage"]
        for f in fixtures
        if "pdf" in f["match"].get("userMessage", "").lower()
    ]
    assert len(prompts) == 1, f"expected exactly one PDF fixture, got {prompts}"
    return prompts[0]


def _sample_pdf_content() -> Content:
    """The real bundled sample PDF as an inline data-URI content part."""
    return Content.from_data(
        data=_SAMPLE_PDF.read_bytes(), media_type="application/pdf"
    )


def _image_content() -> Content:
    """A tiny real PNG as an inline data-URI content part."""
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAF"
        "AAH/q842iQAAAABJRU5ErkJggg=="
    )
    return Content.from_data(data=png, media_type="image/png")


def _client() -> OpenAIChatCompletionClient:
    """A real client instance. Only its serialiser is used — no network I/O."""
    return OpenAIChatCompletionClient(model="gpt-4o-mini", api_key="sk-test-not-used")


async def _run_middleware(messages: list[Message]) -> list[Message]:
    """Drive the real middleware and capture the messages the client would see.

    Returns the message list as it existed *inside* ``call_next`` — i.e. the
    rewritten, model-facing view.
    """
    seen: list[Message] = []
    context = ChatContext(client=_client(), messages=messages, options=None)

    async def call_next() -> None:
        # Snapshot the model-facing contents before the middleware's `finally`
        # restores the originals.
        seen.extend(
            Message(role=m.role, contents=list(m.contents or []))
            for m in context.messages
        )

    await _PdfFlattenChatMiddleware().process(context, call_next)
    return seen


def _wire_messages(messages: list[Message]) -> list[dict[str, Any]]:
    """Serialise messages through the REAL OpenAI wire serialiser."""
    client = _client()
    wire: list[dict[str, Any]] = []
    for message in messages:
        wire.extend(client._prepare_message_for_openai(message))
    return wire


def _text_of(wire_message: dict[str, Any]) -> str:
    """Extract text from a wire message whose content may be a string or a list."""
    content = wire_message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            part.get("text", "") for part in content if part.get("type") == "text"
        )
    return ""


def _last_user_text(wire: list[dict[str, Any]]) -> str:
    users = [m for m in wire if m.get("role") == "user"]
    assert users, "no user message in the outbound payload"
    return _text_of(users[-1])


@pytest.mark.asyncio
async def test_pdf_turn_last_user_message_contains_the_prompt() -> None:
    """THE regression guard: the question must survive to the final user turn.

    This is the assertion that was RED. Whatever aimock or a real model reads as
    "the current user turn" is the last user message; before the fix it held only
    the flattened document body.
    """
    prompt = _pdf_prompt_from_fixture()
    turn = Message(
        role="user",
        contents=[Content.from_text(text=prompt), _sample_pdf_content()],
    )

    wire = _wire_messages(await _run_middleware([turn]))
    last_user_text = _last_user_text(wire)

    assert prompt in last_user_text, (
        "the user's question was dropped from the final outbound user message; "
        f"it reads: {last_user_text[:200]!r}"
    )
    # The document must still reach the model — the fix must not trade the
    # attachment away to keep the prompt.
    assert DOC_MARKER in last_user_text
    assert "CopilotKit" in last_user_text, "real pypdf text extraction produced nothing"


@pytest.mark.asyncio
async def test_pdf_turn_serialises_to_a_single_user_message() -> None:
    """One logical user turn must stay ONE outbound user message.

    Directly pins the mechanism: a second text ``Content`` would be split off
    into its own trailing user message by ``agent_framework_openai``.
    """
    prompt = _pdf_prompt_from_fixture()
    turn = Message(
        role="user",
        contents=[Content.from_text(text=prompt), _sample_pdf_content()],
    )

    wire = _wire_messages(await _run_middleware([turn]))
    user_messages = [m for m in wire if m.get("role") == "user"]

    assert len(user_messages) == 1, (
        "expected the PDF turn to serialise to 1 user message, got "
        f"{len(user_messages)}: "
        f"{[_text_of(m)[:60] for m in user_messages]}"
    )


def test_openai_serialiser_splits_multiple_contents_into_separate_messages() -> None:
    """Pin the upstream behavior this fix works around.

    Not a test of our code — it documents that
    ``agent_framework_openai`` emits one message per ``Content``, which is why
    the flattened document has to be merged into the prompt's text content
    rather than appended beside it. If this ever stops being true, the merge
    becomes belt-and-braces rather than load-bearing, and this test says so by
    failing.
    """
    two_text_contents = Message(
        role="user",
        contents=[
            Content.from_text(text="what is in this pdf"),
            Content.from_text(text=f"{DOC_MARKER}\nbody text"),
        ],
    )

    wire = _wire_messages([two_text_contents])

    assert len(wire) == 2, f"expected the serialiser to split, got {wire}"
    assert "what is in this pdf" not in _text_of(wire[-1]), (
        "upstream no longer strands the prompt in a separate message"
    )


@pytest.mark.asyncio
async def test_middleware_restores_original_contents_after_the_call() -> None:
    """The flattened text must not bleed into the AG-UI MESSAGES_SNAPSHOT.

    The middleware swaps ``message.contents`` for the model call and restores it
    afterwards; the merge must not mutate the prompt ``Content`` in place, or the
    restore would be a no-op and the chat bubble would render the raw PDF body.
    """
    prompt = _pdf_prompt_from_fixture()
    prompt_content = Content.from_text(text=prompt)
    pdf_content = _sample_pdf_content()
    turn = Message(role="user", contents=[prompt_content, pdf_content])
    original = list(turn.contents or [])

    await _run_middleware([turn])

    assert list(turn.contents or []) == original
    assert prompt_content.text == prompt, "the prompt Content was mutated in place"
    assert DOC_MARKER not in (prompt_content.text or "")
    assert pdf_content in (turn.contents or []), "the PDF content part was not restored"


@pytest.mark.asyncio
async def test_duplicate_pdf_parts_are_flattened_once() -> None:
    """The page's LegacyConverterShim mirrors each attachment, so we see it twice.

    The document body must be emitted once — sending it twice doubles prompt
    tokens for no benefit.
    """
    prompt = _pdf_prompt_from_fixture()
    turn = Message(
        role="user",
        contents=[
            Content.from_text(text=prompt),
            _sample_pdf_content(),
            _sample_pdf_content(),  # the legacy `binary` mirror
        ],
    )

    last_user_text = _last_user_text(_wire_messages(await _run_middleware([turn])))

    assert prompt in last_user_text
    assert last_user_text.count(DOC_MARKER) == 1, (
        f"document body emitted {last_user_text.count(DOC_MARKER)}x, expected once"
    )


@pytest.mark.asyncio
async def test_attachment_only_turn_still_flattens_the_document() -> None:
    """A PDF with no accompanying question must still reach the model."""
    turn = Message(role="user", contents=[_sample_pdf_content()])

    last_user_text = _last_user_text(_wire_messages(await _run_middleware([turn])))

    assert DOC_MARKER in last_user_text
    assert "CopilotKit" in last_user_text


@pytest.mark.asyncio
async def test_image_turn_is_left_untouched() -> None:
    """Images are vision-native — the middleware must not rewrite them.

    Guards the turn that already worked: the image must stay a real image part,
    not get flattened or merged into the prompt.
    """
    prompt = "can you tell me what is in this demo image I just attached"
    image = _image_content()
    turn = Message(role="user", contents=[Content.from_text(text=prompt), image])

    seen = await _run_middleware([turn])

    contents = list(seen[0].contents or [])
    assert [c.type for c in contents] == ["text", "data"]
    assert contents[0].text == prompt, "prompt text was altered on an image-only turn"
    assert contents[1] is image, "the image content part was rewritten"
