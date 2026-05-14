"""Integration tests verifying loop-prevention mechanisms work together.

These tests exercise the text-termination guard in `stop_on_terminal_text`
and verify that `MAX_LLM_CALLS` is set to a reasonable value for RunConfig.

Duplicate tool-call detection is now handled by `prevent_duplicate_tool_calls`
(a before_model_callback) -- see test_prevent_duplicate_tool_calls.py.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from agents.shared_chat import (
    MAX_LLM_CALLS,
    stop_on_terminal_text,
)


class FakeInvocationContext:
    def __init__(self):
        self.end_invocation = False


class FakeCallbackContext:
    def __init__(self, agent_name="IntegrationTestAgent"):
        self.agent_name = agent_name
        self._invocation_context = FakeInvocationContext()


def _make_part(*, text=None, function_call=None):
    return SimpleNamespace(text=text, function_call=function_call)


def _make_response(*, parts=None, role="model"):
    return SimpleNamespace(
        content=SimpleNamespace(role=role, parts=list(parts or [])),
        partial=False,
        error_message=None,
    )


def test_max_llm_calls_is_reasonable():
    """MAX_LLM_CALLS must be a sane value for RunConfig."""
    assert 5 <= MAX_LLM_CALLS <= 20


def test_text_response_terminates_immediately():
    """A final text-only model response should end the invocation on the
    first callback -- the most basic termination path."""
    ctx = FakeCallbackContext()
    resp = _make_response(parts=[_make_part(text="Here are your flights.")])
    stop_on_terminal_text(ctx, resp)
    assert ctx._invocation_context.end_invocation is True


def test_mixed_text_and_function_call_does_not_terminate():
    """A response with BOTH text and function_call should NOT terminate --
    the function_call still needs to execute."""
    ctx = FakeCallbackContext()
    resp = _make_response(
        parts=[
            _make_part(text="Processing..."),
            _make_part(function_call=SimpleNamespace(name="search", args={})),
        ]
    )
    stop_on_terminal_text(ctx, resp)
    assert ctx._invocation_context.end_invocation is False


def test_partial_response_skipped():
    """Partial streaming responses should be ignored -- never terminate
    mid-stream even if the chunk contains text-only parts."""
    ctx = FakeCallbackContext()
    resp = SimpleNamespace(
        content=SimpleNamespace(
            role="model", parts=[_make_part(text="partial text")]
        ),
        partial=True,
        error_message=None,
    )
    stop_on_terminal_text(ctx, resp)
    assert ctx._invocation_context.end_invocation is False
