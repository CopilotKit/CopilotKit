"""The multimodal sub-app relies on AG2 1.x's own run-input parsing.

The ``multimodal`` showcase cell sends user messages whose ``content`` mixes
modern AG-UI parts (``image`` / ``document``) with a legacy ``binary`` mirror
appended by the frontend's legacy-converter shim
(``src/app/demos/multimodal/legacy-converter-shim.tsx``). ``RunAgentInput`` no
longer models ``binary``, but AG2's ``read_run_input`` strips unrecognised
parts (with a warning) instead of refusing the run — so the modern part the
mirror duplicates is all the agent needs, and no custom normalizer is mounted.

These tests pin that contract against AG2's real parser: if a future AG2
refuses the legacy part, the multimodal cell breaks and this fails first.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENAI_API_KEY", "test-key-not-used")

_SRC_ROOT = Path(__file__).resolve().parents[2] / "src"
if str(_SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(_SRC_ROOT))

from ag2.ag_ui.run_input import read_run_input  # noqa: E402

# A 1x1 PNG, base64-encoded.
_SAMPLE_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII="
_SAMPLE_PDF_B64 = "JVBERi0xLjQKJYCAgIAKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoK"


def _body(*parts: dict) -> bytes:
    return json.dumps(
        {
            "threadId": "t",
            "runId": "r",
            "state": {},
            "tools": [],
            "context": [],
            "forwardedProps": {},
            "messages": [{"id": "m1", "role": "user", "content": list(parts)}],
        }
    ).encode()


def _modern(kind: str, mime: str, value: str) -> dict:
    return {"type": kind, "source": {"type": "data", "value": value, "mimeType": mime}}


def _legacy_binary(mime: str, value: str) -> dict:
    return {"type": "binary", "mimeType": mime, "data": value}


def test_modern_image_and_document_parts_are_kept():
    parsed = read_run_input(
        _body(
            {"type": "text", "text": "what is this?"},
            _modern("image", "image/png", _SAMPLE_PNG_B64),
            _modern("document", "application/pdf", _SAMPLE_PDF_B64),
        )
    )
    assert [p.type for p in parsed.messages[0].content] == ["text", "image", "document"]


def test_legacy_binary_mirror_is_stripped_not_refused():
    parsed = read_run_input(
        _body(
            {"type": "text", "text": "what is this?"},
            _modern("image", "image/png", _SAMPLE_PNG_B64),
            _legacy_binary("image/png", _SAMPLE_PNG_B64),
        )
    )
    assert [p.type for p in parsed.messages[0].content] == ["text", "image"]


def test_multimodal_app_is_constructible():
    from agents.multimodal_agent import multimodal_app

    assert multimodal_app is not None
