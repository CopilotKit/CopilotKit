"""Unit tests for before_model_modifier.

Verifies that sales-todo state is serialized into the LLM system prompt and
that missing / malformed state degrades gracefully (no crash, no leaking
internal errors into the prompt).
"""

from __future__ import annotations

from types import SimpleNamespace

from google.genai import types

from agents.main import before_model_modifier


class FakeCallbackContext:
    def __init__(
        self,
        *,
        agent_name: str = "SalesPipelineAgent",
        state: dict | None = None,
    ) -> None:
        self.agent_name = agent_name
        self.state = {} if state is None else state


def _make_request() -> SimpleNamespace:
    """Build a minimal LlmRequest-like object with an empty system_instruction config."""
    config = SimpleNamespace(system_instruction=None)
    return SimpleNamespace(config=config)


def _system_text(request) -> str:
    """Concatenate all system_instruction part texts for assertion."""
    si = request.config.system_instruction
    if si is None:
        return ""
    if not isinstance(si, types.Content):
        return str(si)
    return "".join((p.text or "") for p in (si.parts or []))


# ---------------------------------------------------------------------------
# Happy path: serialized todos appear in the prompt.
# ---------------------------------------------------------------------------


def test_todos_serialized_into_system_prompt():
    todos = [
        {"id": "1", "title": "Call Acme", "status": "open"},
        {"id": "2", "title": "Send proposal", "status": "done"},
    ]
    ctx = FakeCallbackContext(state={"todos": todos})
    request = _make_request()

    before_model_modifier(ctx, request)

    text = _system_text(request)
    assert "Call Acme" in text
    assert "Send proposal" in text
    assert "manage_sales_todos" in text


# ---------------------------------------------------------------------------
# Missing state: must not crash and must fall back to neutral placeholder.
# ---------------------------------------------------------------------------


def test_missing_todos_state_does_not_crash_and_uses_placeholder():
    ctx = FakeCallbackContext(state={})  # no "todos" key at all
    request = _make_request()

    # Must not raise.
    before_model_modifier(ctx, request)

    text = _system_text(request)
    assert "No sales todos yet" in text


def test_none_todos_state_uses_placeholder():
    ctx = FakeCallbackContext(state={"todos": None})
    request = _make_request()

    before_model_modifier(ctx, request)

    text = _system_text(request)
    assert "No sales todos yet" in text


# ---------------------------------------------------------------------------
# Non-serializable todos: error must NOT leak into the prompt.
# ---------------------------------------------------------------------------


def test_non_serializable_todos_do_not_leak_error_into_prompt():
    # Sets are not JSON-serializable → json.dumps raises TypeError.
    ctx = FakeCallbackContext(state={"todos": {"bad": {1, 2, 3}}})
    request = _make_request()

    before_model_modifier(ctx, request)

    text = _system_text(request)
    # Error text must not bleed into the LLM prompt (that was the prior bug).
    assert "Error serializing todos" not in text
    # Neutral placeholder should be used instead.
    assert "No sales todos yet" in text


# ---------------------------------------------------------------------------
# Different agent name: callback should be a no-op.
# ---------------------------------------------------------------------------


def test_non_sales_pipeline_agent_is_noop():
    ctx = FakeCallbackContext(agent_name="SomeOtherAgent", state={"todos": [{"id": "x"}]})
    request = _make_request()

    before_model_modifier(ctx, request)

    # system_instruction should be untouched (still None).
    assert request.config.system_instruction is None
