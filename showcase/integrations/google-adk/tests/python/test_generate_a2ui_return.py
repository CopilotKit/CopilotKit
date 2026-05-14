"""Tests for generate_a2ui human-readable return values (success path).

The success path of generate_a2ui must return both a "result" key with
human-readable data (so Gemini sees structured success information and
stops re-calling) AND the existing "a2ui_operations" key for middleware
rendering. Error paths should NOT be modified.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from agents.main import _get_genai_client, generate_a2ui


class FakeToolContext:
    """Minimal tool_context replica with .state."""

    def __init__(self, state: dict | None = None) -> None:
        self.state = {} if state is None else state


def _genai_response(*, candidates=None):
    """Build a fake google.genai GenerateContentResponse-like object."""
    return SimpleNamespace(candidates=candidates or [])


def _candidate(*, parts=None):
    """Build a fake candidate with a .content.parts chain."""
    return SimpleNamespace(content=SimpleNamespace(parts=parts or []))


def _function_call_part(*, name: str = "render_a2ui", args=None):
    """Build a fake response Part carrying a function_call."""
    return SimpleNamespace(
        text=None,
        function_call=SimpleNamespace(name=name, args=args),
    )


@pytest.fixture(autouse=True)
def _reset_client_cache():
    """Clear the lru_cache on _get_genai_client between tests."""
    _get_genai_client.cache_clear()
    yield
    _get_genai_client.cache_clear()


def _make_success_args():
    """Return valid render_a2ui args dict."""
    return {
        "surfaceId": "kpi-dashboard",
        "catalogId": "copilotkit://app-dashboard-catalog",
        "components": [
            {"id": "root", "component": "Column", "children": ["metric1"]},
            {"id": "metric1", "component": "Metric", "label": "Revenue", "value": "$1M"},
        ],
    }


def _make_fake_client(args):
    """Build a MagicMock genai client that returns a successful render_a2ui call."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(
        candidates=[_candidate(parts=[_function_call_part(args=args)])]
    )
    return fake_client


def test_generate_a2ui_success_includes_human_readable_result():
    """Success path must include a 'result' key with a string value."""
    args = _make_success_args()
    fake_client = _make_fake_client(args)
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    assert "result" in result, f"missing 'result' key in: {result.keys()}"
    assert isinstance(result["result"], str), f"'result' is not str: {type(result['result'])}"


def test_generate_a2ui_success_still_has_a2ui_operations():
    """Success path must still contain the a2ui_operations list."""
    args = _make_success_args()
    fake_client = _make_fake_client(args)
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    assert "a2ui_operations" in result, f"missing 'a2ui_operations' in: {result.keys()}"
    assert isinstance(result["a2ui_operations"], list)
    assert len(result["a2ui_operations"]) > 0


def test_generate_a2ui_success_result_mentions_surface():
    """The human-readable summary should mention surfaceId or component count."""
    args = _make_success_args()
    fake_client = _make_fake_client(args)
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    summary = result["result"]
    # Should mention the surfaceId
    assert "kpi-dashboard" in summary, f"surfaceId not in summary: {summary}"
    # Should mention component count (2 components after sanitization)
    assert "2" in summary, f"component count not in summary: {summary}"


def test_generate_a2ui_error_paths_unchanged():
    """Error returns (no candidates, no parts, etc.) must NOT have a 'result' key.
    They should still use the {error, message, remediation} shape."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(candidates=[])
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    assert "error" in result
    assert "result" not in result, (
        f"error path should NOT have 'result' key: {result.keys()}"
    )
