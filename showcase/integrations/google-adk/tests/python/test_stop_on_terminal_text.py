"""Regression tests for the universal Gemini loop-stopper.

`stop_on_terminal_text` (in `agents/shared_chat.py`) flips
`callback_context._invocation_context.end_invocation = True` iff the final
non-partial model response contains TEXT and NO function_call. Wired into
every registered LlmAgent in `agents/registry.py` via the `build_*`
factories in shared_chat plus a manual `after_model_callback=` on every
dedicated agent (tool_rendering, gen_ui_*, hitl_*, a2ui_*, etc.).

Without this callback Gemini 2.5-flash re-issues the same tool indefinitely
after each successful tool result; PR #4792's "all tools repeat infinitely"
symptom was the visible manifestation. Pinning the truth table here prevents
silent regressions when the callback or its wiring is refactored.

Mirrors the parallel `test_after_model_modifier.py` which covers the
SalesPipelineAgent-scoped legacy `simple_after_model_modifier` — the new
test asserts the SAME behavior but for the demos that actually ship.
"""

from __future__ import annotations

from types import SimpleNamespace

from agents.shared_chat import stop_on_terminal_text


class FakeInvocationContext:
    def __init__(self) -> None:
        self.end_invocation = False


class FakeCallbackContext:
    def __init__(self, agent_name: str = "ToolRenderingAgent") -> None:
        self.agent_name = agent_name
        self._invocation_context = FakeInvocationContext()


def _make_part(*, text: str | None = None, function_call: object | None = None):
    part = SimpleNamespace()
    part.text = text
    part.function_call = function_call
    return part


def _make_response(
    *,
    parts=None,
    partial: bool = False,
    role: str = "model",
    finish_reason: object = "STOP",
):
    """Build a fake LlmResponse.

    `finish_reason` defaults to "STOP" because that's the real terminal
    response shape — `stop_on_terminal_text` gates termination on it to
    avoid premature termination on Gemini thinking-mode chunks that arrive
    non-partial with `finish_reason=None` (the text-only chunk that precedes
    the function-call chunk).
    """
    return SimpleNamespace(
        content=SimpleNamespace(role=role, parts=list(parts or [])),
        partial=partial,
        error_message=None,
        finish_reason=finish_reason,
        turn_complete=None,
    )


def test_terminates_on_final_text_only_model_response():
    """The happy path: final response is text without a function_call → stop."""
    ctx = FakeCallbackContext()
    resp = _make_response(parts=[_make_part(text="Tokyo is sunny, 68°F.")])
    stop_on_terminal_text(ctx, resp)
    assert ctx._invocation_context.end_invocation is True


def test_does_not_terminate_on_mixed_text_and_function_call():
    """Gemini sometimes emits text + function_call together; tool must still run."""
    ctx = FakeCallbackContext()
    resp = _make_response(
        parts=[
            _make_part(text="Looking up the weather in Tokyo for you."),
            _make_part(function_call=SimpleNamespace(name="get_weather")),
        ]
    )
    stop_on_terminal_text(ctx, resp)
    assert ctx._invocation_context.end_invocation is False


def test_does_not_terminate_on_pure_function_call():
    """No text, only function_call → keep going."""
    ctx = FakeCallbackContext()
    resp = _make_response(
        parts=[_make_part(function_call=SimpleNamespace(name="get_weather"))]
    )
    stop_on_terminal_text(ctx, resp)
    assert ctx._invocation_context.end_invocation is False


def test_does_not_terminate_on_partial_stream_chunk():
    """Belt-and-suspenders with ADK_DISABLE_PROGRESSIVE_SSE_STREAMING — never
    end on a partial event even if it happens to contain text-only parts."""
    ctx = FakeCallbackContext()
    resp = _make_response(
        parts=[_make_part(text="Partial fragment...")],
        partial=True,
    )
    stop_on_terminal_text(ctx, resp)
    assert ctx._invocation_context.end_invocation is False


def test_does_not_terminate_on_non_model_role():
    """Only terminate on `role == "model"` responses. Defensive guard against
    user or system role responses sneaking into the callback."""
    ctx = FakeCallbackContext()
    resp = _make_response(parts=[_make_part(text="hello")], role="user")
    stop_on_terminal_text(ctx, resp)
    assert ctx._invocation_context.end_invocation is False


def test_handles_missing_invocation_context_gracefully():
    """ADK's `_invocation_context` is private — log-and-degrade instead of
    crashing the callback when it disappears (would stall the whole request)."""
    ctx = SimpleNamespace(agent_name="ToolRenderingAgent", _invocation_context=None)
    resp = _make_response(parts=[_make_part(text="terminal text")])
    # Must not raise.
    stop_on_terminal_text(ctx, resp)
    # No invocation_context to flip — nothing to assert beyond no-raise.


def test_handles_invocation_context_without_end_invocation_attr():
    """If `_invocation_context` exists but doesn't expose `end_invocation`
    (ADK shape drift), the callback logs and continues without raising."""
    bad_ctx = object()  # no end_invocation attribute
    ctx = SimpleNamespace(agent_name="ToolRenderingAgent", _invocation_context=bad_ctx)
    resp = _make_response(parts=[_make_part(text="terminal text")])
    # Must not raise — the AttributeError on setattr is swallowed and logged.
    stop_on_terminal_text(ctx, resp)


def test_handles_error_message_branch_without_crashing():
    """When Gemini surfaces error_message (quota, safety, context-overflow)
    the callback must not flip end_invocation and must not raise."""
    ctx = FakeCallbackContext()
    resp = SimpleNamespace(
        content=SimpleNamespace(role="model", parts=[]),
        partial=False,
        error_message="quota exhausted",
    )
    stop_on_terminal_text(ctx, resp)
    assert ctx._invocation_context.end_invocation is False
