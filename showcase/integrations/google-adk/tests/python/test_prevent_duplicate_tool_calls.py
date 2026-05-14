"""Tests proving that prevent_duplicate_tool_calls stops infinite tool loops.

RED-GREEN methodology: these tests are written BEFORE the implementation.
They must FAIL initially, then PASS after adding the before_model_callback.

The root cause: Gemini 2.5-flash re-issues the same tool call with the same
arguments after receiving a valid function_response. The fix: detect duplicate
consecutive function_call events in session history and set
FunctionCallingConfig(mode="NONE") to force text output.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest


# --- Test fixtures that simulate ADK structures ---


class FakeEvent:
    """Simulates google.adk.events.Event."""

    def __init__(self, function_calls=None):
        self._function_calls = function_calls or []

    def get_function_calls(self):
        return self._function_calls


class FakeFunctionCall:
    """Simulates google.genai.types.FunctionCall."""

    def __init__(self, name: str, args: dict | None = None):
        self.name = name
        self.args = args or {}


class FakeSession:
    def __init__(self, events=None):
        self.events = events or []


class FakeCallbackContext:
    def __init__(self, events=None):
        self.session = FakeSession(events or [])
        self.agent_name = "test_agent"


class FakeLlmRequest:
    """Simulates google.adk.models.LlmRequest with mutable config."""

    def __init__(self):
        self.config = FakeConfig()


class FakeConfig:
    def __init__(self):
        self.tool_config = None


# --- THE TESTS ---


def test_duplicate_tool_call_sets_mode_none():
    """When the last two function_call events have the same tool name and args,
    mode should be set to NONE to force Gemini to produce text."""
    from agents.shared_chat import prevent_duplicate_tool_calls

    fc = FakeFunctionCall("get_weather", {"location": "NYC"})
    events = [
        FakeEvent(),  # user message
        FakeEvent([fc]),  # first tool call
        FakeEvent(),  # function response
        FakeEvent([fc]),  # DUPLICATE tool call (same name + same args)
        FakeEvent(),  # function response
    ]
    ctx = FakeCallbackContext(events)
    req = FakeLlmRequest()

    prevent_duplicate_tool_calls(ctx, req)

    assert req.config.tool_config is not None, "tool_config should be set"
    fc_config = req.config.tool_config.function_calling_config
    assert fc_config.mode == "NONE", f"mode should be NONE, got {fc_config.mode}"


def test_different_args_does_not_set_mode_none():
    """Same tool but different args is a legitimate multi-call pattern
    (e.g. GenUiAgent calling set_steps with different statuses). Must NOT trigger."""
    from agents.shared_chat import prevent_duplicate_tool_calls

    fc1 = FakeFunctionCall("set_steps", {"steps": [{"status": "pending"}]})
    fc2 = FakeFunctionCall("set_steps", {"steps": [{"status": "completed"}]})
    events = [
        FakeEvent([fc1]),
        FakeEvent(),
        FakeEvent([fc2]),
        FakeEvent(),
    ]
    ctx = FakeCallbackContext(events)
    req = FakeLlmRequest()

    prevent_duplicate_tool_calls(ctx, req)

    assert req.config.tool_config is None, "tool_config should NOT be set for different args"


def test_different_tools_does_not_set_mode_none():
    """Calling different tools in sequence is normal. Must NOT trigger."""
    from agents.shared_chat import prevent_duplicate_tool_calls

    fc1 = FakeFunctionCall("get_weather", {"location": "NYC"})
    fc2 = FakeFunctionCall("search_flights", {"origin": "SFO"})
    events = [
        FakeEvent([fc1]),
        FakeEvent(),
        FakeEvent([fc2]),
        FakeEvent(),
    ]
    ctx = FakeCallbackContext(events)
    req = FakeLlmRequest()

    prevent_duplicate_tool_calls(ctx, req)

    assert req.config.tool_config is None


def test_single_tool_call_does_not_trigger():
    """Only one tool call in history -- no duplicate to detect."""
    from agents.shared_chat import prevent_duplicate_tool_calls

    fc = FakeFunctionCall("get_weather", {"location": "NYC"})
    events = [
        FakeEvent(),
        FakeEvent([fc]),
        FakeEvent(),
    ]
    ctx = FakeCallbackContext(events)
    req = FakeLlmRequest()

    prevent_duplicate_tool_calls(ctx, req)

    assert req.config.tool_config is None


def test_no_tool_calls_does_not_trigger():
    """No tool calls at all -- pure text conversation."""
    from agents.shared_chat import prevent_duplicate_tool_calls

    events = [FakeEvent(), FakeEvent()]
    ctx = FakeCallbackContext(events)
    req = FakeLlmRequest()

    prevent_duplicate_tool_calls(ctx, req)

    assert req.config.tool_config is None


def test_none_args_duplicate_detected():
    """Tools called with None args (no arguments) should still detect duplicates."""
    from agents.shared_chat import prevent_duplicate_tool_calls

    fc = FakeFunctionCall("generate_a2ui", None)
    events = [
        FakeEvent([fc]),
        FakeEvent(),
        FakeEvent([fc]),
        FakeEvent(),
    ]
    ctx = FakeCallbackContext(events)
    req = FakeLlmRequest()

    prevent_duplicate_tool_calls(ctx, req)

    assert req.config.tool_config is not None
    assert req.config.tool_config.function_calling_config.mode == "NONE"


def test_parallel_tool_calls_duplicate_detected():
    """When Gemini issues multiple tool calls in one turn, and the same set
    is issued again, it should be detected as a duplicate."""
    from agents.shared_chat import prevent_duplicate_tool_calls

    fc_a = FakeFunctionCall("get_weather", {"location": "NYC"})
    fc_b = FakeFunctionCall("get_stock_price", {"ticker": "AAPL"})
    events = [
        FakeEvent([fc_a, fc_b]),  # parallel calls
        FakeEvent(),
        FakeEvent([fc_a, fc_b]),  # DUPLICATE parallel calls
        FakeEvent(),
    ]
    ctx = FakeCallbackContext(events)
    req = FakeLlmRequest()

    prevent_duplicate_tool_calls(ctx, req)

    assert req.config.tool_config is not None
    assert req.config.tool_config.function_calling_config.mode == "NONE"


def test_parallel_calls_different_order_not_duplicate():
    """Same tools but in different order should NOT be considered duplicate
    (Gemini may reorder parallel calls)."""
    from agents.shared_chat import prevent_duplicate_tool_calls

    fc_a = FakeFunctionCall("get_weather", {"location": "NYC"})
    fc_b = FakeFunctionCall("get_stock_price", {"ticker": "AAPL"})
    events = [
        FakeEvent([fc_a, fc_b]),
        FakeEvent(),
        FakeEvent([fc_b, fc_a]),  # same tools, different order
        FakeEvent(),
    ]
    ctx = FakeCallbackContext(events)
    req = FakeLlmRequest()

    prevent_duplicate_tool_calls(ctx, req)

    # This is debatable -- same set but different order. Safe to NOT trigger.
    # The next iteration would catch it if it's truly a loop.
    assert req.config.tool_config is None
