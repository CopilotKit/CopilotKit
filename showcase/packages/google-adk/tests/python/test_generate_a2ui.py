"""Unit tests for generate_a2ui.

Covers:
- OpenAI client memoization via functools.lru_cache (thread-safe, no race).
- Structured error shape consistency across all failure branches: each error
  return MUST have {error, message, remediation}.
- Warning log when tool_context.state["copilotkit"] is a non-dict (schema
  drift signal).
"""

from __future__ import annotations

import logging
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from agents.main import _a2ui_error, _get_openai_client, generate_a2ui


# ---------------------------------------------------------------------------
# Helpers / fakes
# ---------------------------------------------------------------------------


class FakeToolContext:
    """Minimal tool_context replica with .state and no _invocation_context."""

    def __init__(self, state: dict | None = None) -> None:
        self.state = {} if state is None else state


def _openai_response(*, choices=None):
    """Build a fake OpenAI ChatCompletion-like response."""
    return SimpleNamespace(choices=choices or [])


def _choice(*, tool_calls=None):
    return SimpleNamespace(message=SimpleNamespace(tool_calls=tool_calls))


def _tool_call(*, arguments: str):
    return SimpleNamespace(function=SimpleNamespace(arguments=arguments))


@pytest.fixture(autouse=True)
def _reset_client_cache():
    """Clear the lru_cache on _get_openai_client between tests so each test
    gets a fresh client instance (otherwise memoization leaks across tests)."""
    _get_openai_client.cache_clear()
    yield
    _get_openai_client.cache_clear()


# ---------------------------------------------------------------------------
# Memoization (finding #1)
# ---------------------------------------------------------------------------


def test_openai_client_memoization_returns_same_instance():
    """Two calls must return the same instance (no re-construction)."""
    sentinel = object()
    with patch("openai.OpenAI", return_value=sentinel) as mock_cls:
        first = _get_openai_client()
        second = _get_openai_client()
    assert first is second is sentinel
    assert mock_cls.call_count == 1


def test_openai_client_memoization_cache_info():
    """lru_cache reports 1 miss + 1 hit after two calls."""
    with patch("openai.OpenAI", return_value=object()):
        _get_openai_client()
        _get_openai_client()
    info = _get_openai_client.cache_info()
    assert info.misses == 1
    assert info.hits == 1


# ---------------------------------------------------------------------------
# Error shape consistency (finding #2)
# ---------------------------------------------------------------------------


def _assert_full_error_shape(result: dict) -> None:
    """Every generate_a2ui error branch must include these three keys."""
    assert isinstance(result, dict), f"expected dict, got {type(result).__name__}"
    for key in ("error", "message", "remediation"):
        assert key in result, f"missing '{key}' in error result: {result!r}"
        assert isinstance(result[key], str) and result[key], (
            f"'{key}' must be non-empty str; got {result.get(key)!r}"
        )


def test_generate_a2ui_openai_exception_returns_full_error_shape():
    """OpenAI client .create() raising an openai.APIError subclass →
    a2ui_llm_error with all keys. We use APIConnectionError (a real
    subclass) to exercise the narrowed except clause."""
    import openai

    fake_client = MagicMock()
    # APIConnectionError requires a request kwarg; build a minimal stub.
    fake_client.chat.completions.create.side_effect = openai.APIConnectionError(
        request=MagicMock()
    )
    with patch("agents.main._get_openai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_llm_error"


def test_generate_a2ui_empty_choices_returns_full_error_shape():
    """Empty response.choices → a2ui_empty_response with all keys."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _openai_response(choices=[])
    with patch("agents.main._get_openai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_empty_response"


def test_generate_a2ui_no_tool_calls_returns_full_error_shape():
    """choices[0].message.tool_calls is None → a2ui_no_tool_call with all keys."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _openai_response(
        choices=[_choice(tool_calls=None)]
    )
    with patch("agents.main._get_openai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_no_tool_call"


def test_generate_a2ui_empty_tool_calls_returns_full_error_shape():
    """choices[0].message.tool_calls is [] → a2ui_no_tool_call with all keys."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _openai_response(
        choices=[_choice(tool_calls=[])]
    )
    with patch("agents.main._get_openai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_no_tool_call"


def test_generate_a2ui_unparseable_arguments_returns_full_error_shape():
    """tool_call.function.arguments is not valid JSON → a2ui_invalid_arguments."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _openai_response(
        choices=[_choice(tool_calls=[_tool_call(arguments="not-json {{{")])]
    )
    with patch("agents.main._get_openai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_invalid_arguments"


def test_generate_a2ui_missing_invocation_context_still_completes_cleanly():
    """Tool context without _invocation_context must not crash — generate_a2ui
    falls through to the OpenAI call with an empty conversation history. The
    implementation uses `getattr(tool_context, '_invocation_context', None)`
    with an explicit `if value is None` guard (rather than a bare try/except
    AttributeError), so the missing attribute is detected and session-history
    extraction is skipped. The OpenAI mock below then drives the normal
    branch."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _openai_response(choices=[])
    with patch("agents.main._get_openai_client", return_value=fake_client):
        # FakeToolContext intentionally has no _invocation_context.
        result = generate_a2ui(FakeToolContext())
    # With no choices, we fall into the empty_response branch — still a full
    # structured error shape.
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_empty_response"


# ---------------------------------------------------------------------------
# Schema drift warning (finding #4)
# ---------------------------------------------------------------------------


def test_non_dict_copilotkit_state_logs_warning(caplog):
    """When state['copilotkit'] is present but not a dict, emit a WARNING."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _openai_response(choices=[])
    ctx = FakeToolContext(state={"copilotkit": "not-a-dict"})
    with patch("agents.main._get_openai_client", return_value=fake_client):
        with caplog.at_level(logging.WARNING, logger="agents.main"):
            generate_a2ui(ctx)
    warnings = [
        rec
        for rec in caplog.records
        if rec.levelno == logging.WARNING
        and "copilotkit" in rec.getMessage()
        and "expected dict" in rec.getMessage()
    ]
    assert warnings, (
        f"expected a WARNING about non-dict copilotkit state, got: "
        f"{[r.getMessage() for r in caplog.records]}"
    )


def test_dict_copilotkit_state_does_not_log_warning(caplog):
    """When state['copilotkit'] IS a dict, no schema-drift warning."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _openai_response(choices=[])
    ctx = FakeToolContext(state={"copilotkit": {"context": []}})
    with patch("agents.main._get_openai_client", return_value=fake_client):
        with caplog.at_level(logging.WARNING, logger="agents.main"):
            generate_a2ui(ctx)
    for rec in caplog.records:
        assert "expected dict" not in rec.getMessage(), (
            f"unexpected schema-drift warning when state was a proper dict: {rec.getMessage()}"
        )


def test_missing_copilotkit_state_does_not_log_warning(caplog):
    """When state has no 'copilotkit' key at all, no warning (default {})."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _openai_response(choices=[])
    ctx = FakeToolContext(state={})
    with patch("agents.main._get_openai_client", return_value=fake_client):
        with caplog.at_level(logging.WARNING, logger="agents.main"):
            generate_a2ui(ctx)
    for rec in caplog.records:
        assert "expected dict" not in rec.getMessage()


def test_non_list_context_entries_logs_warning(caplog):
    """When state['copilotkit']['context'] is present but not a list, emit
    a WARNING about the schema drift (CR round 3 finding #6)."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _openai_response(choices=[])
    ctx = FakeToolContext(state={"copilotkit": {"context": "not-a-list"}})
    with patch("agents.main._get_openai_client", return_value=fake_client):
        with caplog.at_level(logging.WARNING, logger="agents.main"):
            generate_a2ui(ctx)
    warnings = [
        rec
        for rec in caplog.records
        if rec.levelno == logging.WARNING
        and "context" in rec.getMessage()
        and "expected list" in rec.getMessage()
    ]
    assert warnings, (
        f"expected a WARNING about non-list context entries, got: "
        f"{[r.getMessage() for r in caplog.records]}"
    )


def test_list_context_entries_does_not_log_warning(caplog):
    """When state['copilotkit']['context'] IS a list, no schema-drift warning."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _openai_response(choices=[])
    ctx = FakeToolContext(state={"copilotkit": {"context": [{"value": "hi"}]}})
    with patch("agents.main._get_openai_client", return_value=fake_client):
        with caplog.at_level(logging.WARNING, logger="agents.main"):
            generate_a2ui(ctx)
    for rec in caplog.records:
        assert "expected list" not in rec.getMessage(), (
            f"unexpected schema-drift warning when context was a proper list: {rec.getMessage()}"
        )


# ---------------------------------------------------------------------------
# _a2ui_error contract check (CR round 3 finding #1)
# ---------------------------------------------------------------------------


def test_a2ui_error_accepts_full_shape():
    err = _a2ui_error(error="e", message="m", remediation="r")
    assert err == {"error": "e", "message": "m", "remediation": "r"}


def test_a2ui_error_rejects_empty_values():
    """Empty-string values for any required key must blow up at construction
    time, not silently produce a malformed error surface."""
    with pytest.raises(AssertionError):
        _a2ui_error(error="", message="m", remediation="r")
    with pytest.raises(AssertionError):
        _a2ui_error(error="e", message="", remediation="r")
    with pytest.raises(AssertionError):
        _a2ui_error(error="e", message="m", remediation="")


# ---------------------------------------------------------------------------
# Narrowed except (CR round 3 finding #4): programmer errors must propagate.
# ---------------------------------------------------------------------------


def test_generate_a2ui_lets_programmer_errors_propagate():
    """A bare RuntimeError from the OpenAI call is NOT in the narrowed
    (openai.APIError, ...) hierarchy — it should propagate rather than be
    silently converted to an a2ui_llm_error dict."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.side_effect = RuntimeError("programmer bug")
    with patch("agents.main._get_openai_client", return_value=fake_client):
        with pytest.raises(RuntimeError, match="programmer bug"):
            generate_a2ui(FakeToolContext())
