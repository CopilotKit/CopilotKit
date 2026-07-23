"""Regression test: AG-UI image/document content parts must be rewritten
to autogen-acceptable ``image_url`` parts before the multimodal sub-app
hands the request to autogen's ``ConversableAgent``.

Failure under test
==================
The D6 ``multimodal`` probe sends a user message whose content list
includes the modern AG-UI shape::

    {"type": "image",
     "source": {"type": "data",
                "value": "<base64-png>",
                "mime_type": "image/png"}}

(plus a legacy ``{"type": "binary", "mimeType": ..., "data": ...}``
mirror appended by ``src/app/demos/multimodal/legacy-converter-shim.tsx``
to keep the @ag-ui/langgraph converter happy on other integrations).

Autogen's ``code_utils.content_str`` only accepts content-part types in
``{"text", "input_text", "image_url", "input_image", "function",
"tool_call", "tool_calls"}``. Anything else triggers::

    ValueError("Wrong content format: unknown type <type> within the
    content")

…before the request reaches the vision model — observed live in the D6
multimodal probe and recorded in commit d8a0a25db (which originally
NSF-quarantined the feature).

The fix is ``NormalizingAGUIStream`` in ``agents._multimodal_normalize``,
which subclasses ``AGUIStream`` and normalises the parsed
``RunAgentInput`` messages AFTER Pydantic validation (where ``image`` is
a valid AG-UI type) and BEFORE ``AgentService`` serialises them for
autogen (where only ``image_url`` passes ``content_str``). The rewrite
converts AG-UI image / document / binary parts to OpenAI Chat
Completions ``image_url`` parts, leaving text and already-normalised
parts untouched.

What this test asserts
======================
1. **RED → GREEN**: ``content_str`` raises on the raw AG-UI shape
   (``test_autogen_rejects_raw_agui_image_part``) but accepts the
   normalised output (``test_normalized_content_is_accepted_by_autogen``).
   This pins the fix to the actual autogen call site, not to a
   structural look-alike — if autogen ever relaxes the gate, the RED
   half of the pin will start passing and we'll know to revisit.
2. **Shape coverage**: modern image/document data-source, modern
   url-source, legacy binary data/url, and text-passthrough cases
   each get a focused assertion.
3. **Idempotency**: re-running the normalizer on already-normalised
   content is a no-op.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest


# autogen's ConversableAgent module-load path checks for an LLM key, even
# though we never make a network call below — we only invoke the
# allowed-types content gate. Seed a dummy value so import-time
# validation passes regardless of the developer's shell env.
os.environ.setdefault("OPENAI_API_KEY", "test-key-not-used")

# Make ``agents._multimodal_normalize`` importable. The integration root
# is two levels up (tests/python/ ⇒ <integration>/), the agents/ package
# lives under src/.
_INTEGRATION_ROOT = Path(__file__).resolve().parents[2]
_SRC_ROOT = _INTEGRATION_ROOT / "src"
if str(_SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(_SRC_ROOT))

from agents._multimodal_normalize import (  # noqa: E402
    NormalizingAGUIStream,
    normalize_messages_for_autogen,
)


# ---------------------------------------------------------------------------
# Sample payloads — small enough to read in-context, large enough to
# exercise each AG-UI content shape the frontend actually emits.
# ---------------------------------------------------------------------------

# A 1x1 PNG, base64-encoded. Just enough bytes that data-URL assembly
# is exercised; we never decode + render.
_SAMPLE_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII="
_SAMPLE_PDF_B64 = "JVBERi0xLjQKJYCAgIAKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoK"


def _modern_image_data_part() -> dict:
    return {
        "type": "image",
        "source": {
            "type": "data",
            "value": _SAMPLE_PNG_B64,
            "mime_type": "image/png",
        },
    }


def _modern_image_url_part() -> dict:
    return {
        "type": "image",
        "source": {
            "type": "url",
            "value": "https://example.test/sample.png",
            "mime_type": "image/png",
        },
    }


def _modern_document_data_part() -> dict:
    return {
        "type": "document",
        "source": {
            "type": "data",
            "value": _SAMPLE_PDF_B64,
            "mime_type": "application/pdf",
        },
    }


def _legacy_binary_data_part() -> dict:
    return {
        "type": "binary",
        "mimeType": "image/png",
        "data": _SAMPLE_PNG_B64,
    }


def _legacy_binary_url_part() -> dict:
    return {
        "type": "binary",
        "mimeType": "image/png",
        "url": "https://example.test/sample.png",
    }


# ---------------------------------------------------------------------------
# RED/GREEN pin against autogen's actual content gate.
# ---------------------------------------------------------------------------


def test_autogen_rejects_raw_agui_image_part():
    """Confirm the precise failure mode the normalizer is fixing.

    Without normalization, autogen's ``content_str`` raises
    ``ValueError`` with the verbatim message the D6 probe surfaced.
    This is the RED half of the pin: if autogen ever stops rejecting
    AG-UI image parts, this test starts failing and we'll know to
    revisit the normalizer (it may have become a no-op shim).
    """
    pytest.importorskip("autogen")
    from autogen.code_utils import content_str

    raw_content = [
        {"type": "text", "text": "describe the sample image"},
        _modern_image_data_part(),
    ]
    with pytest.raises(ValueError) as exc_info:
        content_str(raw_content)
    assert "unknown type image" in str(exc_info.value), (
        "expected the exact ValueError text the D6 probe surfaced "
        "('Wrong content format: unknown type image within the "
        "content'); got: " + str(exc_info.value)
    )


def test_normalized_content_is_accepted_by_autogen():
    """The GREEN half of the pin: after normalization,
    ``content_str`` accepts the user-message content list and returns
    a stringified placeholder for the image (autogen substitutes
    ``<image>`` for any ``image_url`` part — see code_utils.py).
    """
    pytest.importorskip("autogen")
    from autogen.code_utils import content_str

    raw_messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe the sample image"},
                _modern_image_data_part(),
            ],
        }
    ]
    normalised = normalize_messages_for_autogen(raw_messages)
    assert isinstance(normalised, list) and len(normalised) == 1
    user_content = normalised[0]["content"]
    # No exception expected — autogen's allowed-types gate accepts
    # every part in the rewritten list.
    rendered = content_str(user_content)
    assert "describe the sample image" in rendered
    # Autogen substitutes "<image>" for any image_url part. Asserting
    # on that substitution proves the part was recognised as an image
    # rather than skipped or rejected.
    assert "<image>" in rendered


# ---------------------------------------------------------------------------
# Shape-coverage assertions.
# ---------------------------------------------------------------------------


def test_modern_image_data_part_becomes_image_url_data_url():
    """``{"type": "image", "source": {"type": "data", ...}}`` →
    ``{"type": "image_url", "image_url": {"url": "data:<mime>;base64,<value>"}}``.
    """
    messages = [
        {
            "role": "user",
            "content": [_modern_image_data_part()],
        }
    ]
    normalised = normalize_messages_for_autogen(messages)
    part = normalised[0]["content"][0]
    assert part == {
        "type": "image_url",
        "image_url": {"url": f"data:image/png;base64,{_SAMPLE_PNG_B64}"},
    }


def test_modern_image_url_part_keeps_remote_url():
    """``{"type": "image", "source": {"type": "url", "value": "https://..."}}`` →
    ``{"type": "image_url", "image_url": {"url": "https://..."}}``.
    """
    messages = [
        {
            "role": "user",
            "content": [_modern_image_url_part()],
        }
    ]
    normalised = normalize_messages_for_autogen(messages)
    assert normalised[0]["content"][0] == {
        "type": "image_url",
        "image_url": {"url": "https://example.test/sample.png"},
    }


def test_modern_document_pdf_part_becomes_image_url_data_url():
    """PDF documents survive the autogen allowed-types gate by
    riding inside an ``image_url`` data URL. The vision model still
    can't read the PDF directly, but at least the request reaches
    the model (which is the failure mode this fix targets — the
    upstream ``content_str`` ValueError before any model call).
    """
    messages = [
        {
            "role": "user",
            "content": [_modern_document_data_part()],
        }
    ]
    normalised = normalize_messages_for_autogen(messages)
    part = normalised[0]["content"][0]
    assert part["type"] == "image_url"
    assert part["image_url"]["url"].startswith("data:application/pdf;base64,")
    assert part["image_url"]["url"].endswith(_SAMPLE_PDF_B64)


def test_legacy_binary_data_part_becomes_image_url_data_url():
    """``{"type": "binary", "mimeType": "image/png", "data": "..."}``
    (appended by legacy-converter-shim.tsx) is normalised the same way."""
    messages = [
        {
            "role": "user",
            "content": [_legacy_binary_data_part()],
        }
    ]
    normalised = normalize_messages_for_autogen(messages)
    assert normalised[0]["content"][0] == {
        "type": "image_url",
        "image_url": {"url": f"data:image/png;base64,{_SAMPLE_PNG_B64}"},
    }


def test_legacy_binary_url_part_becomes_image_url_url():
    """Legacy binary part with ``url`` field (no ``data``) keeps the
    URL intact as the image_url url."""
    messages = [
        {
            "role": "user",
            "content": [_legacy_binary_url_part()],
        }
    ]
    normalised = normalize_messages_for_autogen(messages)
    assert normalised[0]["content"][0] == {
        "type": "image_url",
        "image_url": {"url": "https://example.test/sample.png"},
    }


def test_text_only_user_message_passes_through_unchanged():
    """Plain text content (the vast majority of turns) must hit the
    normalizer as a no-op — neither structurally rewritten nor
    re-wrapped — so non-multimodal demos never pay a behavioural cost
    from this fix."""
    messages = [
        {
            "role": "user",
            "content": [{"type": "text", "text": "hello"}],
        }
    ]
    normalised = normalize_messages_for_autogen(messages)
    # Identity preservation: when nothing changes, the same dict
    # objects are returned (not a deep copy). The middleware uses this
    # to skip body re-serialisation on no-op turns.
    assert normalised[0] is messages[0]
    assert normalised[0]["content"][0] == {"type": "text", "text": "hello"}


def test_plain_string_content_passes_through_unchanged():
    """User messages whose ``content`` is a plain string (the AG-UI
    text-only shape) are forwarded as-is."""
    messages = [
        {"role": "user", "content": "hello"},
    ]
    normalised = normalize_messages_for_autogen(messages)
    assert normalised[0] is messages[0]


def test_assistant_and_tool_messages_are_not_touched():
    """Only user-role messages can carry AG-UI image content parts.
    Assistant / tool / system messages pass through unchanged."""
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": [_modern_image_data_part()]},
        {"role": "assistant", "content": "I see an image."},
        {
            "role": "tool",
            "tool_call_id": "call_1",
            "content": "tool result",
        },
    ]
    normalised = normalize_messages_for_autogen(messages)
    # Only the user message changed.
    assert normalised[0] is messages[0]
    assert normalised[1] is not messages[1]
    assert normalised[1]["content"][0]["type"] == "image_url"
    assert normalised[2] is messages[2]
    assert normalised[3] is messages[3]


def test_normalize_is_idempotent():
    """Running the normalizer on already-normalised content produces
    the same output, so a double-install of the middleware (mistake
    or otherwise) doesn't break the request."""
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe the sample image"},
                _modern_image_data_part(),
            ],
        }
    ]
    first = normalize_messages_for_autogen(messages)
    second = normalize_messages_for_autogen(first)
    assert first == second


def test_mimeType_alias_is_accepted():
    """Some hand-rolled / older payloads use ``mimeType`` (camelCase)
    instead of the AG-UI pydantic ``mime_type``. The normaliser
    accepts both so a frontend running either schema version round-
    trips cleanly."""
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "data",
                        "value": _SAMPLE_PNG_B64,
                        "mimeType": "image/png",
                    },
                }
            ],
        }
    ]
    normalised = normalize_messages_for_autogen(messages)
    part = normalised[0]["content"][0]
    assert part["image_url"]["url"] == f"data:image/png;base64,{_SAMPLE_PNG_B64}"


def test_unrecognised_image_source_drops_to_text_placeholder():
    """If the modality is recognised (image/document/...) but the
    ``source`` shape is malformed, the part is replaced by a text
    placeholder — autogen accepts the part and the user sees a
    triagable error rather than the request hard-failing with the
    autogen ValueError."""
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "garbage"}},
            ],
        }
    ]
    normalised = normalize_messages_for_autogen(messages)
    assert normalised[0]["content"][0] == {
        "type": "text",
        "text": "[unreadable image attachment]",
    }


# ---------------------------------------------------------------------------
# Stream-class smoke: NormalizingAGUIStream is constructible and wraps
# an agent correctly.  We don't spin up uvicorn here — the unit-level
# invariants above guard the regression; this is a tripwire that the
# public surface stayed in place.
# ---------------------------------------------------------------------------


def test_normalizing_agui_stream_is_constructible():
    """``NormalizingAGUIStream`` subclasses ``AGUIStream``, accepts a
    ``ConversableAgent``, and exposes ``build_asgi()`` — the contract
    ``multimodal_agent.py`` relies on."""
    from autogen import ConversableAgent, LLMConfig
    from autogen.ag_ui import AGUIStream

    agent = ConversableAgent(
        name="test_agent",
        llm_config=LLMConfig({"model": "gpt-4o"}),
        human_input_mode="NEVER",
    )
    stream = NormalizingAGUIStream(agent)
    assert isinstance(stream, AGUIStream)
    assert callable(stream.build_asgi)
