"""Regression test: legacy AG-UI ``binary`` mirror parts must be stripped
from user messages before the multimodal sub-app hands the request to
ag2 1.0's AG-UI mapping.

Failure under test
==================
The D6 ``multimodal`` probe sends a user message whose content list
includes the modern AG-UI shape::

    {"type": "image",
     "source": {"type": "data",
                "value": "<base64-png>",
                "mime_type": "image/png"}}

plus a legacy ``{"type": "binary", "mimeType": ..., "data": ...}``
mirror appended by ``src/app/demos/multimodal/legacy-converter-shim.tsx``
to keep the @ag-ui/langgraph converter happy on other integrations.

ag2 1.0 maps the modern shapes natively, but its
``map_agui_content_to_input`` explicitly REJECTS the deprecated
``binary`` type::

    ValueError("AG-UI 'binary' content type is deprecated; ...")

…before the request reaches the vision model.

The fix is ``NormalizingAGUIStream`` in ``agents._multimodal_normalize``,
which subclasses ``AGUIStream`` and drops the legacy ``binary`` mirror
parts from the parsed ``RunAgentInput`` AFTER Pydantic validation (where
``binary`` is still a valid AG-UI type) and BEFORE the parent dispatch
maps content parts to agent inputs (where ``binary`` raises).

What this test asserts
======================
1. **RED → GREEN**: ag2's ``map_agui_content_to_input`` raises on a
   ``binary`` part (``test_ag2_rejects_legacy_binary_part``) but accepts
   every part that survives ``strip_legacy_binary_parts``
   (``test_stripped_content_is_accepted_by_ag2``). This pins the fix to
   the actual ag2 call site — if ag2 ever re-accepts ``binary``, the RED
   half of the pin will start failing and we'll know to revisit.
2. **Shape coverage**: binary-next-to-modern-mirror, binary-only
   (placeholder fallback), text passthrough, string-content passthrough,
   and multi-message selective rewrite each get a focused assertion.
3. **No-op fast path**: inputs without binary parts are returned as the
   SAME object (no rebuild).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest


# Seed a dummy key so importing agent modules (which construct configs at
# module level) never depends on the developer's shell env. No network
# call is made below.
os.environ.setdefault("OPENAI_API_KEY", "test-key-not-used")

# Make ``agents._multimodal_normalize`` importable. The integration root
# is two levels up (tests/python/ ⇒ <integration>/), the agents/ package
# lives under src/.
_INTEGRATION_ROOT = Path(__file__).resolve().parents[2]
_SRC_ROOT = _INTEGRATION_ROOT / "src"
if str(_SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(_SRC_ROOT))

from ag_ui.core import (  # noqa: E402
    BinaryInputContent,
    RunAgentInput,
    TextInputContent,
    UserMessage,
)

from ag2.ag_ui.stream import map_agui_content_to_input  # noqa: E402

from agents._multimodal_normalize import (  # noqa: E402
    NormalizingAGUIStream,
    strip_legacy_binary_parts,
)


# A 1x1 PNG, base64-encoded. Just enough bytes that the payload is
# realistic; we never decode + render.
_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII="


def _run_input(*messages) -> RunAgentInput:
    return RunAgentInput(
        thread_id="t1",
        run_id="r1",
        messages=list(messages),
        state={},
        context=[],
        tools=[],
        forwarded_props={},
    )


def _user(mid: str, content) -> UserMessage:
    return UserMessage(id=mid, role="user", content=content)


def _image_part() -> dict:
    return {
        "type": "image",
        "source": {"type": "data", "value": _PNG_B64, "mime_type": "image/png"},
    }


def _binary_part() -> dict:
    return {"type": "binary", "mime_type": "image/png", "data": _PNG_B64}


def _text_part(text: str = "what is on this image?") -> dict:
    return {"type": "text", "text": text}


# ---------------------------------------------------------------------------
# RED half of the pin: ag2 1.0 rejects legacy binary parts
# ---------------------------------------------------------------------------


def test_ag2_rejects_legacy_binary_part() -> None:
    msg = _user("m1", [_binary_part()])
    part = msg.content[0]
    assert isinstance(part, BinaryInputContent)
    with pytest.raises(ValueError, match="deprecated"):
        map_agui_content_to_input(part)


# ---------------------------------------------------------------------------
# GREEN half: everything the stripper keeps is accepted by ag2
# ---------------------------------------------------------------------------


def test_stripped_content_is_accepted_by_ag2() -> None:
    incoming = _run_input(_user("m1", [_text_part(), _image_part(), _binary_part()]))
    stripped = strip_legacy_binary_parts(incoming)
    for part in stripped.messages[0].content:
        # Must not raise for any surviving part.
        map_agui_content_to_input(part)


# ---------------------------------------------------------------------------
# Shape coverage
# ---------------------------------------------------------------------------


def test_binary_mirror_is_dropped_modern_part_kept() -> None:
    incoming = _run_input(_user("m1", [_text_part(), _image_part(), _binary_part()]))
    stripped = strip_legacy_binary_parts(incoming)
    kinds = [type(p).__name__ for p in stripped.messages[0].content]
    assert kinds == ["TextInputContent", "ImageInputContent"]


def test_binary_only_message_gets_text_placeholder() -> None:
    incoming = _run_input(_user("m1", [_binary_part()]))
    stripped = strip_legacy_binary_parts(incoming)
    content = stripped.messages[0].content
    assert len(content) == 1
    assert isinstance(content[0], TextInputContent)
    assert "unreadable" in content[0].text


def test_string_content_passthrough() -> None:
    incoming = _run_input(_user("m1", "plain text question"))
    stripped = strip_legacy_binary_parts(incoming)
    assert stripped is incoming


def test_no_binary_parts_is_noop_same_object() -> None:
    incoming = _run_input(_user("m1", [_text_part(), _image_part()]))
    stripped = strip_legacy_binary_parts(incoming)
    assert stripped is incoming


def test_multiple_messages_only_binary_bearing_rewritten() -> None:
    incoming = _run_input(
        _user("m1", "first question"),
        _user("m2", [_image_part(), _binary_part()]),
        _user("m3", [_text_part("follow-up")]),
    )
    stripped = strip_legacy_binary_parts(incoming)
    assert stripped is not incoming
    assert stripped.messages[0].content == "first question"
    assert [type(p).__name__ for p in stripped.messages[1].content] == [
        "ImageInputContent"
    ]
    assert [type(p).__name__ for p in stripped.messages[2].content] == [
        "TextInputContent"
    ]
    # Untouched messages are carried over as the same objects.
    assert stripped.messages[0] is incoming.messages[0]
    assert stripped.messages[2] is incoming.messages[2]


# ---------------------------------------------------------------------------
# Stream subclass wiring
# ---------------------------------------------------------------------------


def test_normalizing_stream_constructs_and_builds_asgi() -> None:
    from agents.multimodal_agent import multimodal_agent

    stream = NormalizingAGUIStream(multimodal_agent)
    endpoint = stream.build_asgi()
    assert endpoint is not None
