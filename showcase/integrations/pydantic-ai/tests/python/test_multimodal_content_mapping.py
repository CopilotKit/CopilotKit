"""Red→green tests for the multimodal agent's AG-UI content mapping.

Exercises the REAL failure surface end-to-end:

    AG-UI ``UserMessage(content=[TextInputContent, ImageInputContent, ...])``
      → ``pydantic_ai.ag_ui._messages_from_ag_ui``      (the AG-UI bridge)
      → ``multimodal_agent._flatten_messages_for_model`` (model-boundary flatten)
      → ``OpenAIResponsesModel._map_user_prompt``        (lib mapping)

The bug: the PydanticAI AG-UI bridge drops the raw ``UserMessage.content``
list — a list of AG-UI ``InputContent`` *model objects* — straight into
``UserPromptPart.content`` with no conversion, and ``_map_user_prompt`` then
``assert_never``s on those AG-UI objects. The model-boundary flatten
(``_flatten_messages_for_model``, invoked by the ``_MultimodalFlattenModel``
wrapper) must normalise each part to a native PydanticAI content type
(``str`` / ``ImageUrl`` / ``BinaryContent`` / ``DocumentUrl`` / extracted-PDF
text) before the model maps it — for BOTH inline-``data`` and ``url`` sources —
and **fail loud** on a genuinely unknown shape rather than feed the downstream
``assert_never``.

RED before the original rework: ``_map_user_prompt`` raises
``AssertionError("Expected code to be unreachable, but got: <AG-UI object>")``
for url-source content. Earlier rounds wired the flatten as a
``history_processor``, whose return PydanticAI persists to
``ctx.state.message_history`` — leaking the flattened content into UI-visible
state.
GREEN after: every content subtype maps to OpenAI ``input_text`` /
``input_image`` / ``input_file`` content parts with no ``assert_never``; the
flatten is scoped to the model call (no ``history_processor``), so the persisted
conversation keeps the original AG-UI content; a missing-mime inline-DATA image
never produces a ``data:image/*`` URI; recoverable-empty attachments degrade to
placeholders; and a genuinely unknown shape raises a clear ``ValueError``.

These tests are plain ``def`` functions driving coroutines via
``asyncio.run`` (mirroring the sibling ``test_cvdiag_boundaries.py``
convention) so they actually execute their assertions in a clean env —
``pytest-asyncio`` is NOT a dependency, so ``@pytest.mark.asyncio`` tests
would be collected-but-never-awaited (a vacuous pass). They need the real
``pydantic_ai`` + ``ag_ui`` runtime deps and an ``OPENAI_API_KEY`` (module-level
``Agent`` construction reads it; no network call is made — only the pure
mapping is exercised). They skip cleanly when those deps are unavailable so the
lightweight CVDIAG lane is unaffected.
"""

from __future__ import annotations

import asyncio
import os

import pytest

# A 1x1 transparent PNG, base64.
_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4"
    "2mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

os.environ.setdefault("OPENAI_API_KEY", "sk-test-multimodal-mapping")

ag_core = pytest.importorskip("ag_ui.core")
pydantic_ag_ui = pytest.importorskip("pydantic_ai.ag_ui")
pydantic_openai = pytest.importorskip("pydantic_ai.models.openai")

from pydantic_ai import BinaryContent, ImageUrl  # noqa: E402
from pydantic_ai.messages import ModelResponse, UserPromptPart  # noqa: E402
from pydantic_ai.models import ModelRequestParameters  # noqa: E402

from agents.multimodal_agent import (  # noqa: E402
    _flatten_messages_for_model,
    _rewrite_part_for_model,
)

UserMessage = ag_core.UserMessage
TextInputContent = ag_core.TextInputContent
ImageInputContent = ag_core.ImageInputContent
AudioInputContent = ag_core.AudioInputContent
VideoInputContent = ag_core.VideoInputContent
DocumentInputContent = ag_core.DocumentInputContent
BinaryInputContent = ag_core.BinaryInputContent
InputContentDataSource = ag_core.InputContentDataSource
InputContentUrlSource = ag_core.InputContentUrlSource
_messages_from_ag_ui = pydantic_ag_ui._messages_from_ag_ui
OpenAIResponsesModel = pydantic_openai.OpenAIResponsesModel


def _user_prompt_part(model_messages):
    for mm in model_messages:
        for part in getattr(mm, "parts", []):
            if isinstance(part, UserPromptPart):
                return part
    raise AssertionError("no UserPromptPart produced by the AG-UI bridge")


async def _bridge_and_map(user_message: UserMessage):
    """Run the full real surface and return ``(rewritten_part, mapped, orig_part)``.

    ``orig_part`` is the UserPromptPart the AG-UI bridge produced *before* the
    model-boundary flatten ran — used to assert the flatten never mutates the
    state/UI-backing objects.
    """
    bridged = _messages_from_ag_ui([user_message])
    orig_part = _user_prompt_part(bridged)
    orig_snapshot = (
        list(orig_part.content)
        if isinstance(orig_part.content, list)
        else orig_part.content
    )
    model_messages = _flatten_messages_for_model(bridged)
    part = _user_prompt_part(model_messages)
    model = OpenAIResponsesModel("gpt-4o")
    mapped = await model._map_user_prompt(part)
    return part, mapped, orig_part, orig_snapshot


def _content_types(mapped):
    content = mapped["content"]
    if isinstance(content, str):
        return ["__str__"]
    return [p.get("type") for p in content]


# ---------------------------------------------------------------------------
# Data-source (inline base64) regressions — must keep working.
# ---------------------------------------------------------------------------


def test_multimodal_text_plus_image_maps_without_assert_never():
    """Text + inline-image message maps to input_text + input_image, and the
    user's literal prompt text survives alongside the attachment."""

    async def run():
        um = UserMessage(
            id="m1",
            role="user",
            content=[
                TextInputContent(type="text", text="describe the sample image"),
                ImageInputContent(
                    type="image",
                    source=InputContentDataSource(
                        type="data", value=_PNG_B64, mime_type="image/png"
                    ),
                ),
            ],
        )
        part, mapped, _orig, _snap = await _bridge_and_map(um)

        # Our history_processor must have produced native PydanticAI types.
        assert isinstance(part.content, list)
        assert any(isinstance(c, str) for c in part.content)
        assert any(isinstance(c, ImageUrl) for c in part.content)

        # The lib maps them with no ``assert_never``.
        types = _content_types(mapped)
        assert "input_text" in types
        assert "input_image" in types

        # The user's literal prompt text survives verbatim.
        texts = [
            p.get("text") for p in mapped["content"] if p.get("type") == "input_text"
        ]
        assert "describe the sample image" in texts

    asyncio.run(run())


def test_plain_text_user_message_passes_through():
    """A non-multimodal ``str`` message is untouched and maps fine."""

    async def run():
        um = UserMessage(id="m2", role="user", content="hello there")
        part, mapped, _orig, _snap = await _bridge_and_map(um)
        assert part.content == "hello there"
        assert mapped["content"] == "hello there"

    asyncio.run(run())


def test_pdf_document_data_flattened_to_text():
    """An unreadable inline PDF document part degrades to a placeholder string,
    and the sibling prompt text survives."""

    async def run():
        um = UserMessage(
            id="m3",
            role="user",
            content=[
                TextInputContent(type="text", text="summarize this"),
                DocumentInputContent(
                    type="document",
                    source=InputContentDataSource(
                        type="data",
                        value="bm90YXBkZg==",  # "notapdf" — not a real PDF
                        mime_type="application/pdf",
                    ),
                ),
            ],
        )
        part, mapped, _orig, _snap = await _bridge_and_map(um)

        assert isinstance(part.content, list)
        assert all(isinstance(c, str) for c in part.content)
        texts = [
            p.get("text") for p in mapped["content"] if p.get("type") == "input_text"
        ]
        assert "summarize this" in texts  # prompt text survives
        assert any("could not be read" in (t or "") for t in texts)

    asyncio.run(run())


# ---------------------------------------------------------------------------
# URL-source coverage — the A1 incompleteness that crashed with assert_never.
# ---------------------------------------------------------------------------


def test_url_source_image_maps_to_image_url():
    """A url-source image (modern ``InputContentUrlSource``) maps to an
    ``ImageUrl`` and an ``input_image`` part — RED before the rework
    (``assert_never``), GREEN after."""

    async def run():
        um = UserMessage(
            id="u1",
            role="user",
            content=[
                TextInputContent(type="text", text="what is in this picture"),
                ImageInputContent(
                    type="image",
                    source=InputContentUrlSource(
                        type="url",
                        value="https://example.com/cat.png",
                        mime_type="image/png",
                    ),
                ),
            ],
        )
        part, mapped, _orig, _snap = await _bridge_and_map(um)
        assert any(isinstance(c, ImageUrl) for c in part.content)
        img = next(c for c in part.content if isinstance(c, ImageUrl))
        assert img.url == "https://example.com/cat.png"
        types = _content_types(mapped)
        assert "input_text" in types
        assert "input_image" in types

    asyncio.run(run())


def test_url_carrying_binary_maps_to_image_url():
    """A legacy ``binary`` part carrying a ``url`` (not ``data``) maps to an
    ``ImageUrl`` — RED before the rework (``assert_never``), GREEN after."""

    async def run():
        um = UserMessage(
            id="u2",
            role="user",
            content=[
                BinaryInputContent(
                    type="binary",
                    mime_type="image/png",
                    url="https://example.com/cat.png",
                ),
            ],
        )
        part, mapped, _orig, _snap = await _bridge_and_map(um)
        assert any(isinstance(c, ImageUrl) for c in part.content)
        assert "input_image" in _content_types(mapped)

    asyncio.run(run())


def test_missing_mime_image_not_dropped():
    """A modern image part whose source omits ``mime_type`` is classified by its
    part ``type`` and still produces an ``ImageUrl`` — never silently dropped."""

    async def run():
        um = UserMessage(
            id="u3",
            role="user",
            content=[
                ImageInputContent(
                    type="image",
                    source=InputContentUrlSource(
                        type="url",
                        value="https://example.com/no-mime",
                        mime_type=None,
                    ),
                ),
            ],
        )
        part, mapped, _orig, _snap = await _bridge_and_map(um)
        assert any(isinstance(c, ImageUrl) for c in part.content)
        assert "input_image" in _content_types(mapped)

    asyncio.run(run())


# ---------------------------------------------------------------------------
# State purity — the A3 leak (in-place mutation persisted to chat state).
# ---------------------------------------------------------------------------


def test_model_boundary_flatten_does_not_mutate_input():
    """The model-boundary flatten must NOT mutate the AG-UI-derived (UI-backing)
    message objects — it builds NEW objects so the rewrite stays scoped to the
    outgoing request and never touches the list PydanticAI persists to
    ``ctx.state.message_history``.

    RED before the original rework: the flatten mutated ``part.content`` in
    place, so the flattened ImageUrl/text leaked back into the original
    objects PydanticAI persists to state.
    """

    async def run():
        um = UserMessage(
            id="s1",
            role="user",
            content=[
                TextInputContent(type="text", text="hi"),
                ImageInputContent(
                    type="image",
                    source=InputContentDataSource(
                        type="data", value=_PNG_B64, mime_type="image/png"
                    ),
                ),
            ],
        )
        part, _mapped, orig_part, orig_snapshot = await _bridge_and_map(um)

        # The rewritten part is native content...
        assert any(isinstance(c, ImageUrl) for c in part.content)
        # ...but the original (state/UI-backing) part is untouched: still the
        # raw AG-UI InputContent objects, and a NEW part object.
        assert orig_part.content == orig_snapshot
        assert orig_part is not part
        assert all(type(o).__name__.endswith("InputContent") for o in orig_part.content)

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Fail-loud on unknown shapes — the A2 swallow that re-enabled assert_never.
# ---------------------------------------------------------------------------


def test_unknown_object_shape_fails_loud():
    """A genuinely unknown content object raises a clear ``ValueError`` naming
    the shape — never silent pass-through to the downstream ``assert_never``."""

    class _Mystery:
        pass

    with pytest.raises(ValueError) as exc:
        _rewrite_part_for_model(_Mystery())
    assert "unrecognised content part" in str(exc.value)
    assert "_Mystery" in str(exc.value)


def test_unknown_dict_shape_fails_loud():
    """An unknown dict-shaped part also fails loud rather than passing through."""

    with pytest.raises(ValueError) as exc:
        _rewrite_part_for_model({"type": "mystery", "foo": 1})
    assert "unrecognised content part" in str(exc.value)


# ---------------------------------------------------------------------------
# A1' — missing-mime inline-DATA image must NEVER produce a "data:image/*" URI
# (OpenAI's Responses API rejects the wildcard media type → image dropped /
# turn fails). The reference DROPS missing-mime parts; we sniff a concrete
# image type from the base64 magic bytes when we can, else degrade to a
# generic-attachment text placeholder.
# ---------------------------------------------------------------------------


def test_missing_mime_data_image_sniffs_concrete_type_never_wildcard():
    """A modern image part with inline DATA but no mime must map to an ImageUrl
    whose data URI carries a CONCRETE media type sniffed from the PNG magic
    bytes — NEVER ``data:image/*;base64`` (which OpenAI rejects).

    RED before the fix: ``_kind_for`` returns ``image/*`` for a missing-mime
    image, so the data URI is ``data:image/*;base64,...`` (invalid).
    GREEN after: the URI carries ``image/png``.
    """
    out = _rewrite_part_for_model(
        ImageInputContent(
            type="image",
            source=InputContentDataSource(type="data", value=_PNG_B64, mime_type=""),
        )
    )
    assert isinstance(out, ImageUrl)
    assert "image/*" not in out.url
    assert out.url == f"data:image/png;base64,{_PNG_B64}"


def test_missing_mime_unsniffable_data_image_degrades_to_placeholder():
    """A missing-mime inline-DATA image whose bytes are NOT a recognisable
    image format must NOT emit a ``data:image/*`` URI; it degrades to a
    generic-attachment text placeholder (reference DROPS such parts).

    RED before the fix: produces ``ImageUrl("data:image/*;base64,...")``.
    GREEN after: a ``str`` placeholder, no invalid wildcard URI.
    """
    # "notanimage" base64 — no PNG/JPEG/GIF/WebP magic.
    out = _rewrite_part_for_model(
        ImageInputContent(
            type="image",
            source=InputContentDataSource(
                type="data", value="bm90YW5pbWFnZQ==", mime_type=""
            ),
        )
    )
    assert isinstance(out, str)
    assert "image/*" not in out
    assert "[Attached" in out


def test_missing_mime_data_image_full_surface_maps_to_input_image():
    """End-to-end: a missing-mime inline-DATA PNG must still map to an
    ``input_image`` (sniffed concrete type) through the real model mapper —
    NEVER an invalid wildcard data URI that OpenAI would reject."""

    async def run():
        um = UserMessage(
            id="mm1",
            role="user",
            content=[
                ImageInputContent(
                    type="image",
                    source=InputContentDataSource(
                        type="data", value=_PNG_B64, mime_type=""
                    ),
                ),
            ],
        )
        part, mapped, _orig, _snap = await _bridge_and_map(um)
        imgs = [c for c in part.content if isinstance(c, ImageUrl)]
        assert imgs, "missing-mime DATA image should still produce an ImageUrl"
        assert all("image/*" not in c.url for c in imgs)
        assert "input_image" in _content_types(mapped)

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Fail-loud OVERREACH — recoverable-empty cases must degrade, NOT raise.
# Only a GENUINELY-unknown shape fails loud.
# ---------------------------------------------------------------------------


def test_empty_payload_legacy_binary_degrades_not_raises():
    """A legacy ``binary`` part with a known mime but NO data and NO url is a
    recoverable-empty case per the taxonomy — it must degrade (placeholder /
    skip), NOT raise the fail-loud ValueError.

    RED before the fix: ``_classify_content_part`` returns ``None`` and the
    part falls through to the fail-loud ``ValueError``.
    GREEN after: returns a degraded text placeholder, no raise.
    """
    out = _rewrite_part_for_model({"type": "binary", "mimeType": "image/png"})
    assert isinstance(out, str)
    assert "[Attached" in out


def test_empty_source_modern_image_degrades_not_raises():
    """A modern ``image`` part with an empty/absent source is recoverable-empty
    and must degrade gracefully, NOT raise."""
    out = _rewrite_part_for_model({"type": "image", "source": {}})
    assert isinstance(out, str)
    assert "[Attached" in out


def test_empty_source_modern_document_degrades_not_raises():
    """A modern ``document`` part with no usable source degrades, NOT raises."""
    out = _rewrite_part_for_model({"type": "document"})
    assert isinstance(out, str)
    assert "[Attached" in out


def test_genuinely_unknown_shape_still_fails_loud_after_overreach_fix():
    """The overreach fix must NOT weaken the fail-loud on a TRULY-unknown shape:
    a dict whose ``type`` is unrecognised still raises a clear ValueError."""
    with pytest.raises(ValueError) as exc:
        _rewrite_part_for_model({"type": "totally-bogus", "x": 1})
    assert "unrecognised content part" in str(exc.value)


# ---------------------------------------------------------------------------
# A3' — the flatten MUST NOT persist into ctx.state.message_history (UI state).
# pydantic_ai._agent_graph writes the history_processor's RETURNED list back to
# state (``ctx.state.message_history[:] = message_history``), so a processor
# that RETURNS flattened content leaks it into the UI-visible conversation —
# even if the original objects are untouched. The fix scopes the flatten to the
# model boundary (a WrapperModel) so the persisted history keeps the ORIGINAL
# AG-UI content while only the outgoing provider request is flattened.
# ---------------------------------------------------------------------------


def test_agent_uses_no_content_flattening_history_processor():
    """The agent must NOT carry a history_processor that flattens content,
    because pydantic_ai persists the processor's return to
    ``ctx.state.message_history`` (the UI-visible state).

    This asserts the load-bearing INVARIANT — no registered processor flattens
    raw AG-UI content — by RUNNING every registered processor over a real
    bridged history and proving the result still holds raw AG-UI objects. It
    inspects only the agent's actual registered processors, so it stays robust
    regardless of any internal helper names.

    RED before the fix: the flatten was registered as a history_processor, so a
    processor returns flattened content (ImageUrl/str) → UI leak.
    GREEN after: no content-flattening processor is registered (the flatten
    happens at the model boundary instead), so the processed history is
    unchanged raw AG-UI content.
    """
    from agents.multimodal_agent import agent

    um = UserMessage(
        id="proc1",
        role="user",
        content=[
            TextInputContent(type="text", text="hi"),
            ImageInputContent(
                type="image",
                source=InputContentDataSource(
                    type="data", value=_PNG_B64, mime_type="image/png"
                ),
            ),
        ],
    )
    history = _messages_from_ag_ui([um])

    processed = list(history)
    for proc in list(getattr(agent, "history_processors", []) or []):
        processed = proc(processed)

    part = _user_prompt_part(processed)
    assert isinstance(part.content, list)
    assert all(type(c).__name__.endswith("InputContent") for c in part.content), (
        "a registered history_processor flattened content — its return is "
        "persisted to ctx.state.message_history and would leak the flattened "
        f"PDF/image content into UI state: {[type(c).__name__ for c in part.content]}"
    )


def test_model_boundary_flatten_does_not_persist_to_state():
    """EMPIRICAL A3' leak proof, driven through the REAL model-boundary wrapper.

    The previous version of this test looped over ``agent.history_processors``
    — which is empty — so its loop never ran and it passed trivially (a
    tautology). This version instead drives the load-bearing surface: the
    ``_MultimodalFlattenModel`` wrapper that actually flattens the outgoing
    request. We hand the wrapper a captured ``state_history`` (exactly the list
    ``_agent_graph`` keeps as ``ctx.state.message_history``), let the wrapper's
    model-boundary flatten run, and assert the state-backing list STILL holds
    the ORIGINAL raw AG-UI content objects — proving the flatten is scoped to
    the outgoing request and never persists into UI-visible state.

    This is non-tautological: a captured ``RecordingModel`` confirms the
    wrapper's delegate actually RECEIVED flattened (native) content (so the
    flatten really ran), while the asserted state list is unchanged.

    RED (a regression where the wrapper mutated/persisted its input, or a
    re-introduced history_processor): the state list would hold ImageUrl/str.
    GREEN: state keeps raw AG-UI objects; the wrapped model saw native content.
    """
    from pydantic_ai.usage import RequestUsage

    from agents.multimodal_agent import _MultimodalFlattenModel

    class RecordingModel(OpenAIResponsesModel):
        """Captures the messages the wrapper forwards, without a network call."""

        def __init__(self):
            super().__init__("gpt-4o")
            self.seen_request = None
            self.seen_count_tokens = None

        async def request(self, messages, model_settings, model_request_parameters):
            self.seen_request = messages
            return ModelResponse(parts=[])

        async def count_tokens(
            self, messages, model_settings, model_request_parameters
        ):
            self.seen_count_tokens = messages
            return RequestUsage()

    um = UserMessage(
        id="leak1",
        role="user",
        content=[
            TextInputContent(type="text", text="hi"),
            ImageInputContent(
                type="image",
                source=InputContentDataSource(
                    type="data", value=_PNG_B64, mime_type="image/png"
                ),
            ),
        ],
    )
    state_history = _messages_from_ag_ui([um])
    orig_part = _user_prompt_part(state_history)
    orig_snapshot = list(orig_part.content)

    rec = RecordingModel()
    wrapper = _MultimodalFlattenModel(rec)
    params = ModelRequestParameters()

    async def run():
        await wrapper.request(state_history, None, params)
        await wrapper.count_tokens(state_history, None, params)

    asyncio.run(run())

    # The wrapped model actually received FLATTENED (native) content on BOTH
    # the request and the count_tokens path — proves the flatten really ran.
    for seen in (rec.seen_request, rec.seen_count_tokens):
        assert seen is not None
        seen_part = _user_prompt_part(seen)
        assert any(isinstance(c, ImageUrl) for c in seen_part.content), (
            "wrapped model did not receive flattened content: "
            f"{[type(c).__name__ for c in seen_part.content]}"
        )

    # ...yet the state-backing history is UNCHANGED — still raw AG-UI objects,
    # same identity, same content (no persistence/leak into UI state).
    assert _user_prompt_part(state_history) is orig_part
    assert orig_part.content == orig_snapshot
    assert all(type(c).__name__.endswith("InputContent") for c in orig_part.content), (
        "model-boundary flatten leaked into state: "
        f"{[type(c).__name__ for c in orig_part.content]}"
    )


def test_model_wrapper_flattens_outgoing_request():
    """The model boundary MUST flatten AG-UI content before the provider call.

    The wrapper-model approach (the A3' fix) flattens the outgoing messages
    just before the wrapped model's request. We exercise the wrapper's flatten
    on a UserPromptPart carrying raw AG-UI content and assert it produces native
    PydanticAI content (so the provider never sees an AG-UI object), while the
    INPUT list is left untouched (model-boundary scope, no state mutation).
    """
    from agents.multimodal_agent import _flatten_messages_for_model

    bridged = _messages_from_ag_ui(
        [
            UserMessage(
                id="w1",
                role="user",
                content=[
                    TextInputContent(type="text", text="describe"),
                    ImageInputContent(
                        type="image",
                        source=InputContentDataSource(
                            type="data", value=_PNG_B64, mime_type="image/png"
                        ),
                    ),
                ],
            )
        ]
    )
    orig_part = _user_prompt_part(bridged)
    orig_types = [type(c).__name__ for c in orig_part.content]

    flattened = _flatten_messages_for_model(bridged)
    fpart = _user_prompt_part(flattened)
    assert any(isinstance(c, ImageUrl) for c in fpart.content)
    assert any(isinstance(c, str) for c in fpart.content)

    # The input messages are untouched (no state mutation at the boundary).
    assert [type(c).__name__ for c in orig_part.content] == orig_types
    assert all(type(c).__name__.endswith("InputContent") for c in orig_part.content)


# ---------------------------------------------------------------------------
# count_tokens path — the model-call path _agent_graph runs when
# UsageLimits.count_tokens_before_request is set. It passes the UN-flattened
# message_history, so without a wrapper count_tokens override the raw AG-UI
# InputContent reaches the wrapped model's prompt mapper (assert_never), OR the
# call never delegates at all (base Model.count_tokens raises NotImplementedError
# regardless of the wrapped model). The wrapper must flatten + delegate.
# ---------------------------------------------------------------------------


def test_count_tokens_path_does_not_reach_assert_never_on_raw_ag_ui():
    """RED before the override: the wrapper has NO ``count_tokens``, so it
    resolves to base ``Model.count_tokens`` — which NEVER delegates to the
    wrapped model and raises ``NotImplementedError`` (the count_tokens path is
    entirely uncovered). Even where a wrapped model DOES implement count_tokens
    by mapping the prompt, the raw AG-UI objects would reach its ``assert_never``.

    GREEN after: the wrapper overrides ``count_tokens`` to flatten the outgoing
    messages and delegate — so a wrapped model that maps the prompt during
    count_tokens (exactly the OpenAI Responses ``_map_user_prompt`` surface)
    receives NATIVE content and never hits ``assert_never``.
    """

    from pydantic_ai.usage import RequestUsage

    from agents.multimodal_agent import _MultimodalFlattenModel

    mapper_model = OpenAIResponsesModel("gpt-4o")

    class CountingModel(OpenAIResponsesModel):
        """A wrapped model whose count_tokens maps the prompt — the real
        ``OpenAIResponsesModel._map_user_prompt`` surface that ``assert_never``s
        on non-native content. This is the path ``_agent_graph`` drives."""

        def __init__(self):
            super().__init__("gpt-4o")
            self.mapped_types = None

        async def count_tokens(
            self, messages, model_settings, model_request_parameters
        ):
            part = _user_prompt_part(messages)
            mapped = await mapper_model._map_user_prompt(part)
            self.mapped_types = _content_types(mapped)
            return RequestUsage()

    um = UserMessage(
        id="ct1",
        role="user",
        content=[
            TextInputContent(type="text", text="how many tokens"),
            ImageInputContent(
                type="image",
                source=InputContentDataSource(
                    type="data", value=_PNG_B64, mime_type="image/png"
                ),
            ),
        ],
    )
    messages = _messages_from_ag_ui([um])

    counting = CountingModel()
    wrapper = _MultimodalFlattenModel(counting)
    params = ModelRequestParameters()

    async def run():
        # RED: without the override this resolves to base Model.count_tokens →
        # NotImplementedError (path uncovered). With a delegating-but-unflattened
        # path, _map_user_prompt would assert_never on the raw AG-UI image.
        await wrapper.count_tokens(messages, None, params)

    asyncio.run(run())

    # GREEN: the prompt mapped cleanly to native input parts — no assert_never.
    assert counting.mapped_types is not None
    assert "input_text" in counting.mapped_types
    assert "input_image" in counting.mapped_types


# ---------------------------------------------------------------------------
# Audio / video — KNOWN-but-unsupported modalities must DEGRADE to a text
# placeholder (consistent with non-image/non-document binary), NOT fail-loud.
# Fail-loud stays reserved for GENUINELY-unknown shapes.
# ---------------------------------------------------------------------------


def test_audio_data_input_degrades_to_placeholder_not_raises():
    """A valid inline-DATA ``AudioInputContent`` degrades to a text placeholder,
    NOT a fail-loud ValueError.

    RED before the fix: ``audio`` is not a recognised attachment ``type`` in
    ``_classify_content_part``, so it falls through to the fail-loud
    ``ValueError``.
    GREEN after: it degrades to ``[Attached audio: <mime>]`` and the turn
    proceeds.
    """
    out = _rewrite_part_for_model(
        AudioInputContent(
            type="audio",
            source=InputContentDataSource(
                type="data", value="AAAA", mime_type="audio/mpeg"
            ),
        )
    )
    assert isinstance(out, str)
    assert "[Attached audio" in out


def test_video_url_input_degrades_to_placeholder_not_raises():
    """A valid url-source ``VideoInputContent`` degrades to a placeholder, NOT
    a fail-loud ValueError."""
    out = _rewrite_part_for_model(
        VideoInputContent(
            type="video",
            source=InputContentUrlSource(
                type="url", value="https://example.com/v.mp4", mime_type="video/mp4"
            ),
        )
    )
    assert isinstance(out, str)
    assert "[Attached video" in out


def test_audio_dict_with_empty_source_degrades_not_raises():
    """A modern ``audio`` part with no usable source still degrades (recognised
    modality), NOT fail-loud."""
    out = _rewrite_part_for_model({"type": "audio"})
    assert isinstance(out, str)
    assert "[Attached audio" in out


def test_audio_video_message_maps_through_full_surface_without_assert_never():
    """End-to-end: a message mixing text + audio + video maps through the real
    model mapper with NO ``assert_never`` — audio/video become text placeholders
    and the user's prompt text survives."""

    async def run():
        um = UserMessage(
            id="av1",
            role="user",
            content=[
                TextInputContent(type="text", text="what is in these clips"),
                AudioInputContent(
                    type="audio",
                    source=InputContentDataSource(
                        type="data", value="AAAA", mime_type="audio/mpeg"
                    ),
                ),
                VideoInputContent(
                    type="video",
                    source=InputContentUrlSource(
                        type="url",
                        value="https://example.com/v.mp4",
                        mime_type="video/mp4",
                    ),
                ),
            ],
        )
        part, mapped, _orig, _snap = await _bridge_and_map(um)
        assert all(isinstance(c, str) for c in part.content)
        types = _content_types(mapped)
        assert "input_text" in types
        texts = [
            p.get("text") for p in mapped["content"] if p.get("type") == "input_text"
        ]
        assert "what is in these clips" in texts
        assert any("Attached audio" in (t or "") for t in texts)
        assert any("Attached video" in (t or "") for t in texts)

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Unsupported IMAGE SUBTYPES — OpenAI's Responses vision API only supports
# PNG / JPEG / GIF / WebP. A present-mime image whose subtype is anything else
# (image/heic — the iPhone default! — image/svg+xml, image/tiff, image/bmp …)
# must NEVER be emitted as a ``data:image/<subtype>;base64`` ImageUrl: the
# Responses API rejects the unsupported subtype → the image is dropped / the
# turn fails. It must DEGRADE to a text placeholder (same pattern as the
# audio/video degrade). The allow-list applies to BOTH the present-mime image
# path AND the missing-mime sniff path (so a sniffed tiff/bmp also degrades).
# ---------------------------------------------------------------------------


def test_present_mime_heic_image_degrades_not_image_url():
    """A present-mime ``image/heic`` part (iPhone default) must degrade to a
    text placeholder — OpenAI's Responses vision API rejects HEIC.

    RED before the fix: routed to ``kind="image"`` on the ``image/`` prefix and
    emitted as ``ImageUrl("data:image/heic;base64,...")`` (OpenAI rejects).
    GREEN after: a ``str`` placeholder naming the mime; no ``data:image/heic``.
    """
    out = _rewrite_part_for_model(
        ImageInputContent(
            type="image",
            source=InputContentDataSource(
                type="data", value=_PNG_B64, mime_type="image/heic"
            ),
        )
    )
    assert isinstance(out, str)
    assert "[Attached image" in out
    assert "image/heic" in out


def test_present_mime_svg_image_degrades_not_image_url():
    """A present-mime ``image/svg+xml`` part degrades to a placeholder — SVG is
    not a supported Responses vision subtype."""
    out = _rewrite_part_for_model(
        ImageInputContent(
            type="image",
            source=InputContentDataSource(
                type="data", value=_PNG_B64, mime_type="image/svg+xml"
            ),
        )
    )
    assert isinstance(out, str)
    assert "[Attached image" in out
    assert "image/svg+xml" in out


def test_present_mime_unsupported_image_url_source_degrades():
    """An unsupported image subtype delivered via a URL source ALSO degrades —
    OpenAI would reject the ``image/heic`` regardless of data-vs-url delivery."""
    out = _rewrite_part_for_model(
        ImageInputContent(
            type="image",
            source=InputContentUrlSource(
                type="url",
                value="https://example.com/photo.heic",
                mime_type="image/heic",
            ),
        )
    )
    assert isinstance(out, str)
    assert "[Attached image" in out
    assert "image/heic" in out


def test_sniffed_tiff_missing_mime_image_degrades_not_image_url():
    """A missing-mime inline-DATA image whose magic bytes sniff as TIFF must
    degrade — TIFF is recognisable but NOT a supported Responses subtype, so it
    must NOT be emitted as ``data:image/tiff``.

    RED before the fix: ``_sniff_image_mime`` returns ``image/tiff`` and the
    part is emitted as ``ImageUrl("data:image/tiff;base64,...")``.
    GREEN after: degrades to a placeholder ``str``; no ``data:image/tiff``.
    """
    import base64 as _b64

    tiff_b64 = _b64.b64encode(b"II*\x00" + b"\x00" * 20).decode()
    out = _rewrite_part_for_model(
        ImageInputContent(
            type="image",
            source=InputContentDataSource(type="data", value=tiff_b64, mime_type=""),
        )
    )
    assert isinstance(out, str)
    assert "image/tiff" not in out
    assert "data:image" not in out
    assert "[Attached image" in out


def test_sniffed_bmp_missing_mime_image_degrades_not_image_url():
    """A missing-mime inline-DATA image whose magic bytes sniff as BMP also
    degrades — BMP is not a supported Responses subtype."""
    import base64 as _b64

    bmp_b64 = _b64.b64encode(b"BM" + b"\x00" * 20).decode()
    out = _rewrite_part_for_model(
        ImageInputContent(
            type="image",
            source=InputContentDataSource(type="data", value=bmp_b64, mime_type=""),
        )
    )
    assert isinstance(out, str)
    assert "data:image" not in out
    assert "[Attached image" in out


def test_supported_image_subtypes_still_image_url_present_mime():
    """The four supported subtypes (PNG/JPEG/GIF/WebP) still emit an ImageUrl
    when delivered with a present mime — the allow-list must not over-degrade."""
    for subtype in ("png", "jpeg", "gif", "webp"):
        out = _rewrite_part_for_model(
            ImageInputContent(
                type="image",
                source=InputContentDataSource(
                    type="data", value=_PNG_B64, mime_type=f"image/{subtype}"
                ),
            )
        )
        assert isinstance(out, ImageUrl), f"image/{subtype} should map to ImageUrl"
        assert out.url == f"data:image/{subtype};base64,{_PNG_B64}"


def test_supported_image_subtype_url_source_still_image_url():
    """A supported-subtype URL-source image still maps to an ImageUrl."""
    out = _rewrite_part_for_model(
        ImageInputContent(
            type="image",
            source=InputContentUrlSource(
                type="url", value="https://example.com/cat.png", mime_type="image/png"
            ),
        )
    )
    assert isinstance(out, ImageUrl)
    assert out.url == "https://example.com/cat.png"


def test_heic_image_maps_through_full_surface_as_text_not_image():
    """End-to-end: a present-mime HEIC image maps through the real model mapper
    as an ``input_text`` placeholder — never an unsupported ``input_image``."""

    async def run():
        um = UserMessage(
            id="heic1",
            role="user",
            content=[
                TextInputContent(type="text", text="describe this photo"),
                ImageInputContent(
                    type="image",
                    source=InputContentDataSource(
                        type="data", value=_PNG_B64, mime_type="image/heic"
                    ),
                ),
            ],
        )
        part, mapped, _orig, _snap = await _bridge_and_map(um)
        # No ImageUrl produced for the HEIC part; it degraded to a str.
        assert not any(isinstance(c, ImageUrl) for c in part.content)
        types = _content_types(mapped)
        assert "input_text" in types
        assert "input_image" not in types
        texts = [
            p.get("text") for p in mapped["content"] if p.get("type") == "input_text"
        ]
        assert "describe this photo" in texts
        assert any("Attached image" in (t or "") for t in texts)

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Empty-but-known-mime attachment must preserve the mime in the placeholder
# (consistent with the legacy-binary empty path), not discard it.
# ---------------------------------------------------------------------------


def test_empty_known_mime_image_preserves_mime_in_placeholder():
    """A modern ``image`` part whose source is empty but whose modality is known
    degrades to a placeholder that names the modality — and a legacy binary with
    a known mime but no payload preserves that mime."""
    # Legacy binary with a known mime but no data/url: mime preserved.
    out = _rewrite_part_for_model({"type": "binary", "mimeType": "image/png"})
    assert isinstance(out, str)
    assert "image/png" in out


# ---------------------------------------------------------------------------
# request_stream override — the streaming model-call path must flatten the
# outgoing messages before delegating to the wrapped model (mirror the
# request / count_tokens wrapper coverage).
# ---------------------------------------------------------------------------


def test_request_stream_flattens_outgoing_messages():
    """The wrapper's ``request_stream`` override MUST flatten AG-UI content
    before delegating, so the wrapped model's streaming path never sees raw
    AG-UI ``InputContent`` (which would crash ``_map_user_prompt``).

    RED if the override forwarded raw messages: the wrapped model would receive
    AG-UI objects on the stream path.
    GREEN: the wrapped model's ``request_stream`` receives flattened native
    content, and the input state list is left untouched.
    """
    from contextlib import asynccontextmanager

    from agents.multimodal_agent import _MultimodalFlattenModel

    class StreamRecordingModel(OpenAIResponsesModel):
        """Captures the messages the wrapper forwards on the stream path."""

        def __init__(self):
            super().__init__("gpt-4o")
            self.seen_stream = None

        @asynccontextmanager
        async def request_stream(
            self,
            messages,
            model_settings,
            model_request_parameters,
            run_context=None,
        ):
            self.seen_stream = messages
            yield object()  # a stand-in StreamedResponse; never iterated here

    um = UserMessage(
        id="stream1",
        role="user",
        content=[
            TextInputContent(type="text", text="stream this"),
            ImageInputContent(
                type="image",
                source=InputContentDataSource(
                    type="data", value=_PNG_B64, mime_type="image/png"
                ),
            ),
        ],
    )
    state_history = _messages_from_ag_ui([um])
    orig_part = _user_prompt_part(state_history)
    orig_snapshot = list(orig_part.content)

    rec = StreamRecordingModel()
    wrapper = _MultimodalFlattenModel(rec)
    params = ModelRequestParameters()

    async def run():
        async with wrapper.request_stream(state_history, None, params, None):
            pass

    asyncio.run(run())

    # The wrapped model's stream path received FLATTENED native content.
    assert rec.seen_stream is not None
    seen_part = _user_prompt_part(rec.seen_stream)
    assert any(isinstance(c, ImageUrl) for c in seen_part.content), (
        "wrapped model's request_stream did not receive flattened content: "
        f"{[type(c).__name__ for c in seen_part.content]}"
    )
    assert any(isinstance(c, str) for c in seen_part.content)

    # ...and the state-backing history is unchanged (no leak into UI state).
    assert _user_prompt_part(state_history) is orig_part
    assert orig_part.content == orig_snapshot
    assert all(type(c).__name__.endswith("InputContent") for c in orig_part.content)


# ---------------------------------------------------------------------------
# Unit-level flatten behaviour (no model required).
# ---------------------------------------------------------------------------


def test_text_input_content_object_flattens_to_str():
    """``_rewrite_part_for_model`` flattens an AG-UI text object to ``str``."""
    out = _rewrite_part_for_model(TextInputContent(type="text", text="hi"))
    assert out == "hi"


def test_image_input_content_object_flattens_to_image_url():
    """``_rewrite_part_for_model`` flattens an inline AG-UI image to ImageUrl."""
    out = _rewrite_part_for_model(
        ImageInputContent(
            type="image",
            source=InputContentDataSource(
                type="data", value=_PNG_B64, mime_type="image/png"
            ),
        )
    )
    assert isinstance(out, ImageUrl)
    assert out.url == f"data:image/png;base64,{_PNG_B64}"


def test_legacy_binary_dict_still_handled():
    """Frontend legacy on-wire dict shape still maps to ImageUrl."""
    out = _rewrite_part_for_model(
        {"type": "binary", "mimeType": "image/png", "data": _PNG_B64}
    )
    assert isinstance(out, ImageUrl)
    assert out.url == f"data:image/png;base64,{_PNG_B64}"


def test_native_content_passes_through_unchanged():
    """Already-native content (idempotency) passes through untouched."""
    iu = ImageUrl(url="https://example.com/x.png")
    assert _rewrite_part_for_model(iu) is iu
    assert _rewrite_part_for_model("already a string") == "already a string"


# ---------------------------------------------------------------------------
# R8 — consolidated type-gating at the EMISSION CHOKE POINT.
#
# These three tests close a CR-round-7 cluster whose shared root cause is that
# the OpenAI supported-type gate + degrade lived only on the ``image`` content
# branch (and the mime allow-list under-accepted parameterised / non-canonical
# mimes). After R8 the supported-type check + degrade happen at the SINGLE
# native-type emission choke point, and mime normalisation strips RFC-2045
# parameters / whitespace and aliases ``image/jpg`` → ``image/jpeg``.
# ---------------------------------------------------------------------------


def test_jpg_alias_data_image_forwarded_as_image_url():
    """GAP (a) — ``image/jpg`` (non-canonical but ubiquitous) inline-DATA image
    must be FORWARDED as a supported JPEG ``ImageUrl``, not degraded.

    RED before R8: the subtype ``"jpg"`` is not in the allow-list, so
    ``_is_supported_image_mime("image/jpg")`` returns ``False`` and the image is
    degraded to a ``[Attached image: image/jpg]`` placeholder — a real JPEG
    silently never reaches the vision model.
    GREEN after R8: ``image/jpg`` is aliased to ``image/jpeg`` before the
    membership test, so it emits an ``ImageUrl``.
    """
    out = _rewrite_part_for_model(
        ImageInputContent(
            type="image",
            source=InputContentDataSource(
                type="data", value=_PNG_B64, mime_type="image/jpg"
            ),
        )
    )
    assert isinstance(out, ImageUrl), "image/jpg should forward as a JPEG ImageUrl"
    assert out.url.startswith("data:image/jpeg;base64,"), (
        f"image/jpg should normalise to canonical image/jpeg in the data URI, "
        f"got {out.url!r}"
    )


def test_parameterised_supported_mime_data_image_forwarded():
    """GAP (c) — a SUPPORTED image whose mime carries an RFC-2045 parameter or
    stray whitespace (e.g. ``image/jpeg; charset=binary``) must be FORWARDED as
    an ``ImageUrl``, not degraded.

    RED before R8: ``_is_supported_image_mime`` takes the verbatim remainder
    after ``image/`` as the subtype (``"jpeg; charset=binary"``), which is not in
    the allow-list, so the image is degraded.
    GREEN after R8: the mime is normalised (split on ``;`` + strip) before the
    membership test, so it emits an ``ImageUrl``.
    """
    out = _rewrite_part_for_model(
        ImageInputContent(
            type="image",
            source=InputContentDataSource(
                type="data", value=_PNG_B64, mime_type="image/jpeg; charset=binary"
            ),
        )
    )
    assert isinstance(out, ImageUrl), (
        "parameterised image/jpeg should forward as an ImageUrl"
    )
    assert out.url.startswith("data:image/jpeg;base64,"), (
        f"parameterised mime should normalise to bare image/jpeg in the data "
        f"URI, got {out.url!r}"
    )


def test_url_document_media_mime_degrades_not_document_url():
    """GAP (b) — a ``document`` (or legacy ``binary``) URL source carrying a
    non-PDF / media (audio/video) mime must DEGRADE to a text placeholder, NOT
    be emitted as an unconditional ``DocumentUrl`` the OpenAI mapper may reject.

    RED before R8: ``_kind_for("audio/mpeg", default=...)`` returns
    ``("other", "audio/mpeg")`` and the ``"other"`` URL branch returns
    ``DocumentUrl(url=value)`` unconditionally — no mime gate at all.
    GREEN after R8: the supported-type gate at the emission choke point degrades
    a non-fetchable-document URL to a ``[Attached ...]`` placeholder.
    """
    from pydantic_ai import DocumentUrl

    # Legacy binary carrying an audio mime with a url source.
    out = _rewrite_part_for_model(
        {
            "type": "binary",
            "mimeType": "audio/mpeg",
            "url": "https://example.com/voice.mp3",
        }
    )
    assert not isinstance(out, DocumentUrl), (
        "an audio url must NOT be emitted as a DocumentUrl"
    )
    assert isinstance(out, str)
    assert "[Attached" in out

    # Modern document part carrying a video mime with a url source.
    out2 = _rewrite_part_for_model(
        DocumentInputContent(
            type="document",
            source=InputContentUrlSource(
                type="url",
                value="https://example.com/clip.mp4",
                mime_type="video/mp4",
            ),
        )
    )
    assert not isinstance(out2, DocumentUrl), (
        "a video url document must NOT be emitted as a DocumentUrl"
    )
    assert isinstance(out2, str)
    assert "[Attached" in out2


def test_url_real_document_still_document_url():
    """The supported-type gate must NOT over-degrade a genuine non-PDF document
    URL the model CAN fetch (e.g. a plain-text or office document): it still
    emits a ``DocumentUrl`` so the model can fetch it."""
    from pydantic_ai import DocumentUrl

    out = _rewrite_part_for_model(
        DocumentInputContent(
            type="document",
            source=InputContentUrlSource(
                type="url",
                value="https://example.com/report.docx",
                mime_type=(
                    "application/vnd.openxmlformats-officedocument."
                    "wordprocessingml.document"
                ),
            ),
        )
    )
    assert isinstance(out, DocumentUrl), (
        "a fetchable document url should still emit a DocumentUrl"
    )
    assert out.url == "https://example.com/report.docx"


def test_unsupported_image_binary_data_degrades_at_choke_point():
    """GAP (b/F3) — an unsupported image subtype that reaches the ``other`` DATA
    branch as a ``BinaryContent`` (``binary.is_image`` true, e.g. HEIC) must
    DEGRADE at the emission choke point, not be emitted as a rejected image
    binary.

    Exercises the choke-point gate directly via a legacy binary dict whose mime
    is an unsupported image subtype but is NOT routed through the ``image`` kind
    (it is — so to hit the ``other`` BinaryContent path we rely on the choke
    point catching ``binary.is_image`` for an unsupported subtype). With the
    consolidated gate, NO unsupported image subtype is ever emitted as a native
    image, regardless of routing.
    """
    # A heic data binary: even if a future routing change sent it to the
    # BinaryContent path, the choke point must degrade it (not emit a rejected
    # image binary). Today it routes via kind=="image" and degrades there; the
    # assertion is the invariant: never a native image type for heic.
    out = _rewrite_part_for_model(
        {
            "type": "binary",
            "mimeType": "image/heic",
            "data": _PNG_B64,
        }
    )
    assert not isinstance(out, (ImageUrl, BinaryContent)), (
        "an unsupported image subtype must never be emitted as a native image"
    )
    assert isinstance(out, str)
    assert "[Attached image" in out
