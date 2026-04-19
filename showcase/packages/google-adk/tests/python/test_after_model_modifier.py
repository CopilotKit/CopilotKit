"""Unit tests for simple_after_model_modifier.

Covers the truth table of (partial, has_text, has_function_call) × role
and asserts that `end_invocation` is flipped exactly when expected.

end_invocation should be set to True iff ALL of:
    - llm_response.content and parts present
    - partial == False (or absent)
    - role == "model"
    - has_text is True
    - has_function_call is False

In all other cases, end_invocation must not be flipped.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from agents.main import simple_after_model_modifier


class FakeInvocationContext:
    """Stub for ADK's private _invocation_context — only carries end_invocation."""

    def __init__(self) -> None:
        self.end_invocation = False


class FakeCallbackContext:
    def __init__(self, agent_name: str = "SalesPipelineAgent") -> None:
        self.agent_name = agent_name
        self._invocation_context = FakeInvocationContext()


def _make_part(*, text: str | None = None, function_call: object | None = None):
    # google.genai Part is a pydantic model with optional fields; SimpleNamespace
    # is enough because the callback uses getattr() to read them.
    part = SimpleNamespace()
    if text is not None:
        part.text = text
    else:
        part.text = None
    if function_call is not None:
        part.function_call = function_call
    else:
        part.function_call = None
    return part


def _make_response(
    *,
    role: str = "model",
    has_text: bool = False,
    has_function_call: bool = False,
    partial: bool = False,
    with_parts: bool = True,
    error_message: str | None = None,
):
    parts = []
    if with_parts:
        parts.append(
            _make_part(
                text="hello" if has_text else None,
                function_call=SimpleNamespace(name="get_weather") if has_function_call else None,
            )
        )
    content = SimpleNamespace(role=role, parts=parts) if with_parts else None
    response = SimpleNamespace(
        content=content,
        partial=partial,
        error_message=error_message,
    )
    return response


# ---------------------------------------------------------------------------
# Terminal case — the ONLY combination that should flip end_invocation.
# ---------------------------------------------------------------------------


def test_flips_end_invocation_on_final_text_only_model_response():
    ctx = FakeCallbackContext()
    response = _make_response(role="model", has_text=True, has_function_call=False, partial=False)

    result = simple_after_model_modifier(ctx, response)

    assert result is None
    assert ctx._invocation_context.end_invocation is True


# ---------------------------------------------------------------------------
# partial × has_text × has_function_call truth table (role=model)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("partial", "has_text", "has_function_call", "expected_end"),
    [
        # (partial=False already covered above for the True case)
        (False, True, True, False),   # text + function_call => must NOT terminate
        (False, False, True, False),  # function_call only => tool call pending
        (False, False, False, False), # empty parts => nothing to terminate on
        (True, True, False, False),   # partial text => wait for turn_complete
        (True, True, True, False),    # partial text + fc => wait
        (True, False, True, False),   # partial fc => wait
        (True, False, False, False),  # partial empty => wait
    ],
)
def test_truth_table_model_role(partial, has_text, has_function_call, expected_end):
    ctx = FakeCallbackContext()
    response = _make_response(
        role="model",
        has_text=has_text,
        has_function_call=has_function_call,
        partial=partial,
    )

    simple_after_model_modifier(ctx, response)

    assert ctx._invocation_context.end_invocation is expected_end


# ---------------------------------------------------------------------------
# role != "model" => never terminate, even on final text-only responses.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("role", ["user", "tool", ""])
def test_non_model_role_never_terminates(role):
    ctx = FakeCallbackContext()
    response = _make_response(role=role, has_text=True, has_function_call=False, partial=False)

    simple_after_model_modifier(ctx, response)

    assert ctx._invocation_context.end_invocation is False


# ---------------------------------------------------------------------------
# Non-SalesPipelineAgent agents should be a no-op entirely.
# ---------------------------------------------------------------------------


def test_non_sales_pipeline_agent_is_noop():
    ctx = FakeCallbackContext(agent_name="SomeOtherAgent")
    response = _make_response(role="model", has_text=True, has_function_call=False, partial=False)

    simple_after_model_modifier(ctx, response)

    assert ctx._invocation_context.end_invocation is False


# ---------------------------------------------------------------------------
# Missing content / error_message paths — should not crash.
# ---------------------------------------------------------------------------


def test_no_content_no_parts_is_safe():
    ctx = FakeCallbackContext()
    response = SimpleNamespace(content=None, partial=False, error_message=None)

    result = simple_after_model_modifier(ctx, response)

    assert result is None
    assert ctx._invocation_context.end_invocation is False


def test_error_message_only_is_safe():
    ctx = FakeCallbackContext()
    response = SimpleNamespace(content=None, partial=False, error_message="something broke")

    result = simple_after_model_modifier(ctx, response)

    assert result is None
    assert ctx._invocation_context.end_invocation is False


# ---------------------------------------------------------------------------
# Defensive fallback — callback_context missing _invocation_context must not crash.
# ---------------------------------------------------------------------------


def test_missing_invocation_context_does_not_crash():
    ctx = SimpleNamespace(agent_name="SalesPipelineAgent")  # no _invocation_context
    response = _make_response(role="model", has_text=True, has_function_call=False, partial=False)

    # The callback must handle the missing attribute gracefully (see the
    # getattr(..., None) guard) and not raise.
    result = simple_after_model_modifier(ctx, response)

    assert result is None
