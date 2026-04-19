"""Unit tests for generate_a2ui.

Covers:
- google.genai client memoization via functools.lru_cache (thread-safe, no race).
- Structured error shape consistency across all failure branches: each error
  return MUST have {error, message, remediation}.
- Warning log when tool_context.state["copilotkit"] is a non-dict (schema
  drift signal).

Rewritten from the OpenAI version: the google-adk package uses google.genai
for the secondary A2UI planner call (forced function_call via ToolConfig
mode="ANY") to avoid a cross-provider OpenAI dependency in a Gemini-primary
package. The ERROR SHAPE and branch coverage are identical to the sibling
strands / langroid adapters.
"""

from __future__ import annotations

import logging
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from agents.main import _a2ui_error, _get_genai_client, generate_a2ui


# ---------------------------------------------------------------------------
# Helpers / fakes
# ---------------------------------------------------------------------------


class FakeToolContext:
    """Minimal tool_context replica with .state and no _invocation_context."""

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


def _text_part(text: str):
    """Build a fake response Part carrying plain text (no function_call)."""
    return SimpleNamespace(text=text, function_call=None)


@pytest.fixture(autouse=True)
def _reset_client_cache():
    """Clear the lru_cache on _get_genai_client between tests so each test
    gets a fresh client instance (otherwise memoization leaks across tests)."""
    _get_genai_client.cache_clear()
    yield
    _get_genai_client.cache_clear()


# ---------------------------------------------------------------------------
# Memoization
# ---------------------------------------------------------------------------


def test_genai_client_memoization_returns_same_instance():
    """Two calls must return the same instance (no re-construction)."""
    sentinel = object()
    with patch("agents.main.genai.Client", return_value=sentinel) as mock_cls:
        first = _get_genai_client()
        second = _get_genai_client()
    assert first is second is sentinel
    assert mock_cls.call_count == 1


def test_genai_client_memoization_cache_info():
    """lru_cache reports 1 miss + 1 hit after two calls."""
    with patch("agents.main.genai.Client", return_value=object()):
        _get_genai_client()
        _get_genai_client()
    info = _get_genai_client.cache_info()
    assert info.misses == 1
    assert info.hits == 1


# ---------------------------------------------------------------------------
# Error shape consistency
# ---------------------------------------------------------------------------


def _assert_full_error_shape(result: dict) -> None:
    """Every generate_a2ui error branch must include these three keys."""
    assert isinstance(result, dict), f"expected dict, got {type(result).__name__}"
    for key in ("error", "message", "remediation"):
        assert key in result, f"missing '{key}' in error result: {result!r}"
        assert isinstance(result[key], str) and result[key], (
            f"'{key}' must be non-empty str; got {result.get(key)!r}"
        )


def test_generate_a2ui_genai_api_error_returns_full_error_shape():
    """Gemini client .generate_content() raising a genai_errors.APIError →
    a2ui_llm_error with all keys. We use ServerError (a real subclass) to
    exercise the narrowed except tuple."""
    from google.genai import errors as genai_errors

    fake_client = MagicMock()
    # ServerError/ClientError/APIError take (code, response_json, response).
    # Build a minimal stub for construction: code, body, raw response.
    fake_client.models.generate_content.side_effect = genai_errors.ServerError(
        500, {"error": {"message": "boom"}}, MagicMock()
    )
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_llm_error"
    assert "GOOGLE_API_KEY" in result["remediation"]


def test_generate_a2ui_empty_candidates_returns_full_error_shape():
    """Empty response.candidates → a2ui_empty_response with all keys."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(candidates=[])
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_empty_response"


def test_generate_a2ui_no_parts_returns_full_error_shape():
    """First candidate has no parts → a2ui_empty_response with all keys."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(
        candidates=[_candidate(parts=[])]
    )
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_empty_response"


def test_generate_a2ui_no_function_call_part_returns_full_error_shape():
    """Parts contain only text (no function_call) → a2ui_no_tool_call."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(
        candidates=[_candidate(parts=[_text_part("I refuse to render UI.")])]
    )
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_no_tool_call"


def test_generate_a2ui_wrong_function_name_returns_full_error_shape():
    """function_call.name != 'render_a2ui' → a2ui_no_tool_call."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(
        candidates=[
            _candidate(
                parts=[_function_call_part(name="some_other_fn", args={"foo": "bar"})]
            )
        ]
    )
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_no_tool_call"


def test_generate_a2ui_none_args_returns_full_error_shape():
    """function_call.args is None → a2ui_invalid_arguments with all keys."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(
        candidates=[_candidate(parts=[_function_call_part(args=None)])]
    )
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_invalid_arguments"


def test_generate_a2ui_string_args_parseable_as_json_succeeds():
    """If SDK ever returns args as a JSON string, we parse it and succeed."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(
        candidates=[
            _candidate(
                parts=[
                    _function_call_part(
                        args='{"surfaceId": "s", "catalogId": "c", "components": []}'
                    )
                ]
            )
        ]
    )
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    # Happy-path: not an error shape — it's the a2ui_operations container.
    assert "error" not in result or result.get("error") is None


def test_generate_a2ui_unparseable_string_args_returns_full_error_shape():
    """If SDK returns args as a malformed JSON string → a2ui_invalid_arguments."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(
        candidates=[_candidate(parts=[_function_call_part(args="not-json {{{")])]
    )
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_invalid_arguments"


def test_generate_a2ui_non_dict_args_returns_full_error_shape():
    """function_call.args is a list / number / str-that-parses-to-list →
    a2ui_invalid_arguments (payload must be a dict)."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(
        candidates=[_candidate(parts=[_function_call_part(args=[1, 2, 3])])]
    )
    with patch("agents.main._get_genai_client", return_value=fake_client):
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_invalid_arguments"


def test_generate_a2ui_happy_path_returns_operations_container():
    """function_call with a valid dict payload → build_a2ui_operations_from_tool_call
    is invoked and its return value becomes generate_a2ui's return value."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(
        candidates=[
            _candidate(
                parts=[
                    _function_call_part(
                        args={
                            "surfaceId": "demo",
                            "catalogId": "cat",
                            "components": [{"type": "text"}],
                        }
                    )
                ]
            )
        ]
    )
    sentinel = {"ok": True, "built": "operations"}
    with patch("agents.main._get_genai_client", return_value=fake_client), patch(
        "agents.main.build_a2ui_operations_from_tool_call", return_value=sentinel
    ) as mock_builder:
        result = generate_a2ui(FakeToolContext())
    assert result is sentinel
    mock_builder.assert_called_once_with(
        {
            "surfaceId": "demo",
            "catalogId": "cat",
            "components": [{"type": "text"}],
        }
    )


def test_generate_a2ui_missing_invocation_context_still_completes_cleanly():
    """Tool context without _invocation_context must not crash — generate_a2ui
    falls through to the Gemini call with an empty conversation history. The
    implementation uses `getattr(tool_context, '_invocation_context', None)`
    with an explicit `if value is None` guard (rather than a bare try/except
    AttributeError), so the missing attribute is detected and session-history
    extraction is skipped."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(candidates=[])
    with patch("agents.main._get_genai_client", return_value=fake_client):
        # FakeToolContext intentionally has no _invocation_context.
        result = generate_a2ui(FakeToolContext())
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_empty_response"


# ---------------------------------------------------------------------------
# Schema drift warning
# ---------------------------------------------------------------------------


def test_non_dict_copilotkit_state_logs_warning(caplog):
    """When state['copilotkit'] is present but not a dict, emit a WARNING."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(candidates=[])
    ctx = FakeToolContext(state={"copilotkit": "not-a-dict"})
    with patch("agents.main._get_genai_client", return_value=fake_client):
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
    fake_client.models.generate_content.return_value = _genai_response(candidates=[])
    ctx = FakeToolContext(state={"copilotkit": {"context": []}})
    with patch("agents.main._get_genai_client", return_value=fake_client):
        with caplog.at_level(logging.WARNING, logger="agents.main"):
            generate_a2ui(ctx)
    for rec in caplog.records:
        assert "expected dict" not in rec.getMessage(), (
            f"unexpected schema-drift warning when state was a proper dict: {rec.getMessage()}"
        )


def test_missing_copilotkit_state_does_not_log_warning(caplog):
    """When state has no 'copilotkit' key at all, no warning (default {})."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(candidates=[])
    ctx = FakeToolContext(state={})
    with patch("agents.main._get_genai_client", return_value=fake_client):
        with caplog.at_level(logging.WARNING, logger="agents.main"):
            generate_a2ui(ctx)
    for rec in caplog.records:
        assert "expected dict" not in rec.getMessage()


def test_non_list_context_entries_logs_warning(caplog):
    """When state['copilotkit']['context'] is present but not a list, emit
    a WARNING about the schema drift."""
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(candidates=[])
    ctx = FakeToolContext(state={"copilotkit": {"context": "not-a-list"}})
    with patch("agents.main._get_genai_client", return_value=fake_client):
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
    fake_client.models.generate_content.return_value = _genai_response(candidates=[])
    ctx = FakeToolContext(state={"copilotkit": {"context": [{"value": "hi"}]}})
    with patch("agents.main._get_genai_client", return_value=fake_client):
        with caplog.at_level(logging.WARNING, logger="agents.main"):
            generate_a2ui(ctx)
    for rec in caplog.records:
        assert "expected list" not in rec.getMessage(), (
            f"unexpected schema-drift warning when context was a proper list: {rec.getMessage()}"
        )


# ---------------------------------------------------------------------------
# _a2ui_error contract check
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
# Narrowed except: programmer errors must propagate.
# ---------------------------------------------------------------------------


def test_generate_a2ui_lets_programmer_errors_propagate():
    """A bare RuntimeError from the Gemini call is NOT in the narrowed
    (genai_errors.APIError, ValueError, ...) hierarchy — it should propagate
    rather than be silently converted to an a2ui_llm_error dict."""
    fake_client = MagicMock()
    fake_client.models.generate_content.side_effect = RuntimeError("programmer bug")
    with patch("agents.main._get_genai_client", return_value=fake_client):
        with pytest.raises(RuntimeError, match="programmer bug"):
            generate_a2ui(FakeToolContext())


# ---------------------------------------------------------------------------
# Config-time failure: genai.Client() construction raising ValueError when
# credentials are missing must become a structured a2ui_llm_error.
# ---------------------------------------------------------------------------


def test_generate_a2ui_client_construction_value_error_returns_structured():
    """If genai.Client() construction raises ValueError (e.g. missing
    GOOGLE_API_KEY in some SDK paths), we catch it and return a structured
    error — not an uncaught exception bypassing the a2ui_error contract."""
    # Clear lru_cache so the patched genai.Client constructor is actually called.
    _get_genai_client.cache_clear()

    def _raise(*_a, **_kw):
        raise ValueError("missing GOOGLE_API_KEY")

    with patch("agents.main.genai.Client", side_effect=_raise):
        result = generate_a2ui(FakeToolContext())

    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_llm_error"
    assert "GOOGLE_API_KEY" in result["remediation"]


# ---------------------------------------------------------------------------
# Model override via A2UI_MODEL env var.
# ---------------------------------------------------------------------------


def test_a2ui_model_env_override(monkeypatch):
    """A2UI_MODEL env var overrides the default model passed to generate_content."""
    from agents.main import _a2ui_model

    monkeypatch.setenv("A2UI_MODEL", "gemini-pro-custom")
    assert _a2ui_model() == "gemini-pro-custom"
    monkeypatch.delenv("A2UI_MODEL", raising=False)
    # Falls back to the hard-coded default.
    assert _a2ui_model() == "gemini-2.5-flash"


def test_generate_a2ui_passes_model_to_client(monkeypatch):
    """generate_a2ui passes the resolved model name to client.models.generate_content."""
    monkeypatch.setenv("A2UI_MODEL", "gemini-test-model")
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = _genai_response(candidates=[])
    with patch("agents.main._get_genai_client", return_value=fake_client):
        generate_a2ui(FakeToolContext())
    _, kwargs = fake_client.models.generate_content.call_args
    assert kwargs["model"] == "gemini-test-model"
