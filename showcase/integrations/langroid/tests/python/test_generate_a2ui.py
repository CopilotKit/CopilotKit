"""Unit tests for langroid's A2UI planner.

Sibling tests to ``showcase/integrations/google-adk/tests/python/test_generate_a2ui.py``
and ``showcase/integrations/strands/tests/python/test_generate_a2ui.py``. Covers:

- Provider-agnostic LLM routing through langroid's ``OpenAIGPT`` abstraction
  (which despite the name handles OpenAI / Anthropic / Gemini / any
  ``provider/model`` chat-model string).
- ``A2UI_MODEL`` env override takes precedence over ``LANGROID_MODEL``.
- Structured error surface (``_A2uiError``) for every failure branch:
    - LLM call raises (transport / auth / rate-limit)
    - response contains no tool call
    - response tool-call arguments are malformed JSON
- Happy path: valid tool call args → ``build_a2ui_operations_from_tool_call``
- Programmer errors (``AttributeError``, ``TypeError``, ``ImportError``,
  ``NameError``, ``AssertionError``, ``NotImplementedError``,
  ``ModuleNotFoundError``, ``pydantic.ValidationError``) propagate — not
  silently masked as LLM errors. Conversely ``KeyError`` / ``IndexError`` /
  ``RecursionError`` / ``MemoryError`` / ``LookupError`` are NO LONGER
  re-raised; they wrap into the structured ``a2ui_llm_error`` surface.
- Construction must not require OpenAI-specific env when a non-OpenAI
  ``LANGROID_MODEL`` is configured (provider-agnostic routing).
- Memoization: the A2UI planner LLM is built once per resolved model string.
- Structured warning / error log output on the module logger for every
  degraded / drift path (with message substring assertions).

Mocks live at the langroid-LLM layer (``lm.OpenAIGPT``) rather than at any
provider SDK layer — the whole point of the provider-agnostic fix is that
the A2UI planner no longer speaks to any provider SDK directly.
"""

from __future__ import annotations

import ast
import inspect
import json
import logging
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from agents.agent import (
    _A2uiError,
    _A2uiErrorKind,
    _RENDER_A2UI_FUNCTION_SPEC,
    _a2ui_error,
    _get_a2ui_llm,
    _resolve_a2ui_model,
    _ToolErrorKind,
    generate_a2ui_via_llm,
    create_agent,
    ALL_TOOLS,
    BACKEND_TOOLS,
    FRONTEND_TOOLS,
    ChangeBackgroundTool,
    GenerateA2UITool,
    GenerateHaikuTool,
    GetSalesTodosTool,
    GetWeatherTool,
    ManageSalesTodosTool,
    QueryDataTool,
    ScheduleMeetingTool,
    SearchFlightsTool,
)
from langroid.agent.tool_message import ToolMessage


# ---------------------------------------------------------------------------
# Fakes / helpers
# ---------------------------------------------------------------------------


@dataclass
class _FakeFunction:
    """Typo-safe stand-in for a langroid tool-call ``function`` attribute.

    Dataclass (rather than ``SimpleNamespace``) so typos in field names blow
    up at construction rather than silently producing a shape that looks
    right but with a missing attribute.
    """

    name: str = "render_a2ui"
    arguments: Any = None


@dataclass
class _FakeOaiToolCall:
    """Typo-safe stand-in for a langroid ``OaiToolCall``."""

    id: str = "call-1"
    function: _FakeFunction | None = None


@dataclass
class _FakeFunctionCall:
    """Typo-safe stand-in for a legacy ``LLMFunctionCall``."""

    name: str = "render_a2ui"
    arguments: Any = None


@dataclass
class _FakeLLMResponse:
    """Typo-safe stand-in for langroid's ``LLMResponse``.

    The planner only reads ``.oai_tool_calls`` and ``.function_call`` so those
    are the only fields we model. Using a dataclass guards against silently
    adding unused attrs via typo.
    """

    message: str = ""
    oai_tool_calls: list | None = None
    function_call: _FakeFunctionCall | None = None


def _llm_response(*, tool_calls=None, function_call=None) -> _FakeLLMResponse:
    """Build a fake langroid ``LLMResponse``-shaped object."""
    return _FakeLLMResponse(
        message="",
        oai_tool_calls=tool_calls,
        function_call=function_call,
    )


def _oai_tool_call(*, arguments, call_id: str = "call-1") -> _FakeOaiToolCall:
    """Build a fake ``OpenAIToolCall``.

    Helper passes the ``arguments`` value through unchanged; callers may
    supply a dict or a JSON string — both paths are exercised by the tests
    below.
    """
    return _FakeOaiToolCall(
        id=call_id,
        function=_FakeFunction(name="render_a2ui", arguments=arguments),
    )


def _function_call(*, arguments) -> _FakeFunctionCall:
    """Build a fake legacy ``LLMFunctionCall``."""
    return _FakeFunctionCall(name="render_a2ui", arguments=arguments)


@pytest.fixture(autouse=True)
def _reset_llm_cache():
    """Clear the memoized A2UI LLM between tests so patched factories are
    honored freshly each test."""
    _get_a2ui_llm.cache_clear()
    yield
    _get_a2ui_llm.cache_clear()


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Unset A2UI_MODEL / LANGROID_MODEL / OPENAI_* / every provider key
    between tests so tests don't leak one another's env setup. The provider
    key set matches what ``_expected_key_for_model`` handles across sibling
    adapters — keeping them all unset here means a regression in provider
    routing can't be silently masked by a stray key in the developer's env.
    """
    for var in (
        "A2UI_MODEL",
        "LANGROID_MODEL",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "OPENROUTER_API_KEY",
        "GROQ_API_KEY",
        "DEEPSEEK_API_KEY",
        "CEREBRAS_API_KEY",
        "GLHF_API_KEY",
        "MINIMAX_API_KEY",
        "PORTKEY_API_KEY",
    ):
        monkeypatch.delenv(var, raising=False)
    yield


# ---------------------------------------------------------------------------
# _A2uiErrorKind enum identity — pins the error-code contract
# ---------------------------------------------------------------------------


def test_a2ui_error_kind_values_pinned():
    """The enum ``.value``s are the string contract shared with the
    frontend renderer and the sibling ``google-adk`` / ``strands`` adapters.
    Renaming any of these is a cross-sibling breaking change; pin the set
    here so a regression is caught at unit-test time rather than by an
    alert from the renderer in production."""
    assert _A2uiErrorKind.LLM_ERROR.value == "a2ui_llm_error"
    assert _A2uiErrorKind.NO_TOOL_CALL.value == "a2ui_no_tool_call"
    assert _A2uiErrorKind.INVALID_ARGUMENTS.value == "a2ui_invalid_arguments"
    assert {m.value for m in _A2uiErrorKind} == {
        "a2ui_llm_error",
        "a2ui_no_tool_call",
        "a2ui_invalid_arguments",
    }


# ---------------------------------------------------------------------------
# _ToolErrorKind enum identity — pins the backend-tool error-code contract
# ---------------------------------------------------------------------------


def test_tool_error_kind_values_pinned():
    """The enum ``.value``s are the ``{"error": "<tool>_failed"}`` strings
    the outer LLM consumes when a backend tool handler wraps an impl
    exception. The values match the historical bare-string codes, so a
    rename here is a cross-language breaking change (the strings show up
    in prompt-engineered retry logic elsewhere in the product). Pin the
    complete set so a typo regression (``"get_wether_failed"``) or an
    accidental addition / removal is caught at unit-test time."""
    assert _ToolErrorKind.GET_WEATHER_FAILED.value == "get_weather_failed"
    assert _ToolErrorKind.QUERY_DATA_FAILED.value == "query_data_failed"
    assert (
        _ToolErrorKind.MANAGE_SALES_TODOS_FAILED.value
        == "manage_sales_todos_failed"
    )
    assert (
        _ToolErrorKind.GET_SALES_TODOS_FAILED.value == "get_sales_todos_failed"
    )
    assert (
        _ToolErrorKind.SCHEDULE_MEETING_FAILED.value
        == "schedule_meeting_failed"
    )
    assert (
        _ToolErrorKind.SEARCH_FLIGHTS_FAILED.value == "search_flights_failed"
    )
    assert {m.value for m in _ToolErrorKind} == {
        "get_weather_failed",
        "query_data_failed",
        "manage_sales_todos_failed",
        "get_sales_todos_failed",
        "schedule_meeting_failed",
        "search_flights_failed",
    }


# ---------------------------------------------------------------------------
# _a2ui_error contract
# ---------------------------------------------------------------------------


def test_a2ui_error_accepts_full_shape():
    err = _a2ui_error(
        error=_A2uiErrorKind.LLM_ERROR, message="m", remediation="r"
    )
    assert err == {
        "error": "a2ui_llm_error",
        "message": "m",
        "remediation": "r",
    }


def test_a2ui_error_rejects_empty_values():
    """Empty-string values for message/remediation must blow up at
    construction time, not silently produce a malformed error surface.
    ``error`` is the enum now, so the only way to get an empty ``error``
    value would be to subvert the enum — not a supported use case."""
    with pytest.raises(ValueError):
        _a2ui_error(error=_A2uiErrorKind.LLM_ERROR, message="", remediation="r")
    with pytest.raises(ValueError):
        _a2ui_error(error=_A2uiErrorKind.LLM_ERROR, message="m", remediation="")


def test_a2ui_error_rejects_non_string_message():
    """The TypedDict annotation says ``str``; the factory must enforce that
    at runtime. A caller accidentally slipping a list/dict/int into
    ``message`` would break the frontend's error renderer."""
    with pytest.raises(ValueError):
        _a2ui_error(
            error=_A2uiErrorKind.LLM_ERROR, message=123, remediation="r"  # type: ignore[arg-type]
        )
    with pytest.raises(ValueError):
        _a2ui_error(
            error=_A2uiErrorKind.LLM_ERROR,
            message="m",
            remediation=["r"],  # type: ignore[arg-type]
        )


def _assert_full_error_shape(result: dict) -> None:
    """Every generate_a2ui error branch must include these three keys and
    ONLY these three keys (no traceback / stderr / secret leakage)."""
    assert isinstance(result, dict), f"expected dict, got {type(result).__name__}"
    # Exactly the three required keys — no extras (catches regressions that
    # leak tracebacks, stderr, or secret material into error dicts).
    assert set(result.keys()) == {"error", "message", "remediation"}, (
        f"unexpected keys in error result: {sorted(result.keys())}"
    )
    for key in ("error", "message", "remediation"):
        assert isinstance(result[key], str) and result[key], (
            f"'{key}' must be non-empty str; got {result.get(key)!r}"
        )


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_generate_a2ui_happy_path_returns_operations():
    """A valid ``oai_tool_calls`` response should be routed through
    ``build_a2ui_operations_from_tool_call`` and return the operations dict.

    Pins the full op shape — surfaceId / catalogId / components / data —
    so a regression that swaps args or drops the data-update op is caught.
    Also asserts the LLM was called with the forced-function-call kwargs
    so the "the planner forces render_a2ui" contract is pinned.
    """
    fake_llm = MagicMock()
    args = {
        "surfaceId": "dynamic-surface",
        "catalogId": "copilotkit://app-dashboard-catalog",
        "components": [{"id": "root", "type": "Container"}],
        "data": {"greeting": "hi"},
    }
    fake_llm.chat.return_value = _llm_response(
        tool_calls=[_oai_tool_call(arguments=args)]
    )
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        result = generate_a2ui_via_llm(context="test context")

    # LLM forced-function-call wiring
    fake_llm.chat.assert_called_once()
    call_kwargs = fake_llm.chat.call_args.kwargs
    assert call_kwargs["functions"] == [_RENDER_A2UI_FUNCTION_SPEC]
    assert call_kwargs["function_call"] == {"name": "render_a2ui"}

    # Message wiring: system prompt from caller's ``context``, plus a user
    # message instructing the planner to emit a dashboard. Both must be
    # present (langroid uses two-message system+user priming) — a regression
    # that drops one would still forward kwargs but emit a broken prompt.
    messages = call_kwargs["messages"]
    assert len(messages) == 2, f"expected system+user messages, got {len(messages)}"
    assert messages[0].content == "test context", (
        f"system message must carry caller's context verbatim; got "
        f"{messages[0].content!r}"
    )

    # Op shape
    assert "a2ui_operations" in result, f"unexpected shape: {result!r}"
    ops = result["a2ui_operations"]
    assert len(ops) == 3

    assert ops[0]["type"] == "create_surface"
    assert ops[0]["surfaceId"] == "dynamic-surface"
    assert ops[0]["catalogId"] == "copilotkit://app-dashboard-catalog"

    assert ops[1]["type"] == "update_components"
    assert ops[1]["components"] == [{"id": "root", "type": "Container"}]

    assert ops[2]["type"] == "update_data_model"
    assert ops[2]["data"] == {"greeting": "hi"}


def test_generate_a2ui_happy_path_json_string_arguments_also_work():
    """If a provider adapter returns ``arguments`` as a JSON string (not a
    pre-parsed dict — some langroid backends do this), the function must
    still parse and succeed. Assert the round-trip — ``surfaceId`` from the
    JSON string makes it into ``a2ui_operations[0].surfaceId`` — so that a
    regression where the parsed dict was dropped on the floor gets caught."""
    fake_llm = MagicMock()
    args_json = json.dumps({
        "surfaceId": "s1",
        "catalogId": "copilotkit://app-dashboard-catalog",
        "components": [{"id": "root", "type": "Container"}],
    })
    fake_llm.chat.return_value = _llm_response(
        tool_calls=[_oai_tool_call(arguments=args_json)]
    )
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        result = generate_a2ui_via_llm(context="")
    assert "a2ui_operations" in result
    assert result["a2ui_operations"][0]["surfaceId"] == "s1"
    # No ``data`` in args → no update_data_model op → exactly 2 ops.
    assert len(result["a2ui_operations"]) == 2, (
        f"expected 2 ops when args has no 'data' key; got "
        f"{len(result['a2ui_operations'])}"
    )
    # Default system prompt must kick in when context is empty.
    call_kwargs = fake_llm.chat.call_args.kwargs
    messages = call_kwargs["messages"]
    assert messages[0].content == "Generate a useful dashboard UI.", (
        f"empty context must trigger the default system prompt; got "
        f"{messages[0].content!r}"
    )


def test_generate_a2ui_legacy_function_call_path():
    """Older / alternate providers surface the forced tool call via
    ``function_call`` rather than ``oai_tool_calls``. Both shapes must work.
    Pin ``surfaceId`` so we know the LEGACY slot's args were consumed (a
    regression that reads from the empty modern slot would fall through to
    ``a2ui_no_tool_call`` — but an even subtler regression could read the
    wrong slot's args)."""
    fake_llm = MagicMock()
    args = {
        "surfaceId": "legacy-surface",
        "catalogId": "copilotkit://app-dashboard-catalog",
        "components": [{"id": "root", "type": "Container"}],
    }
    fake_llm.chat.return_value = _llm_response(
        tool_calls=None,
        function_call=_function_call(arguments=args),
    )
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        result = generate_a2ui_via_llm(context="")
    assert "a2ui_operations" in result
    assert result["a2ui_operations"][0]["surfaceId"] == "legacy-surface"


# ---------------------------------------------------------------------------
# Error branches
# ---------------------------------------------------------------------------


def test_generate_a2ui_llm_exception_returns_full_error_shape(caplog):
    """Runtime exception from ``llm.chat(...)`` → structured ``a2ui_llm_error``
    with all keys populated, and an ERROR-level log on the module logger.

    Also pin the remediation content — the entire point of the
    provider-agnostic fix is that the remediation points at
    ``LANGROID_MODEL`` / ``A2UI_MODEL`` rather than OpenAI-specific env
    variables."""
    fake_llm = MagicMock()
    fake_llm.chat.side_effect = ConnectionError("backend unreachable")
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        with caplog.at_level(logging.ERROR, logger="agents.agent"):
            result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_llm_error"
    # Source formats the message as "...: ClassName: detail" — BOTH parts
    # must be present. Previously used `or`; that weakened the assertion
    # and would pass if the class name alone leaked through.
    assert "ConnectionError" in result["message"]
    assert "backend unreachable" in result["message"]
    # Remediation must reference the provider-agnostic env vars — catches a
    # regression that reintroduces "set OPENAI_API_KEY" phrasing.
    assert "LANGROID_MODEL" in result["remediation"]
    assert "A2UI_MODEL" in result["remediation"]
    # And the module logger must have emitted an ERROR record whose message
    # pins the substring from the source's ``logger.exception(...)`` call.
    assert any(
        rec.levelno >= logging.ERROR
        and rec.name == "agents.agent"
        and "LLM call failed" in rec.getMessage()
        for rec in caplog.records
    ), (
        f"expected ERROR-level log mentioning 'LLM call failed'; got "
        f"{[(r.name, r.levelname, r.getMessage()) for r in caplog.records]}"
    )


def test_generate_a2ui_llm_exception_message_is_truncated_to_200_chars():
    """The source truncates ``str(exc)`` to 200 chars to bound the blast
    radius if a future provider SDK regression embeds credentials /
    huge stack state in exception text. Regression-guard the truncation."""
    fake_llm = MagicMock()
    huge = "X" * 5000
    fake_llm.chat.side_effect = ConnectionError(huge)
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    # Message format: "Secondary A2UI LLM call failed: ConnectionError: <detail>"
    # The <detail> portion must be at most 200 chars (truncated from 5000).
    prefix = "Secondary A2UI LLM call failed: ConnectionError: "
    assert result["message"].startswith(prefix)
    detail = result["message"][len(prefix):]
    # Pin the exact truncation: source slices ``str(exc)[:200]`` with a huge
    # input, so the detail must be EXACTLY the first 200 chars of the
    # stressor string, not merely <=200 (which would accept a regression
    # that truncated to e.g. 50 chars).
    assert detail == "X" * 200, (
        f"detail must be exactly 200 'X's from str(exc)[:200]; got {len(detail)} chars"
    )
    # And the total must not be anywhere near the original 5000.
    assert len(result["message"]) < 500


def test_generate_a2ui_llm_construction_failure_returns_full_error_shape():
    """Failure inside ``_get_a2ui_llm`` (e.g. missing provider-specific API
    key at construction time) must surface as a structured tool result
    rather than propagate as an uncaught exception."""
    def _raise(*_a, **_kw):
        raise ValueError("no API key for provider X")

    with patch("agents.agent._get_a2ui_llm", side_effect=_raise):
        result = generate_a2ui_via_llm(context="")

    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_llm_error"
    # Message must carry both the exception class name (``ValueError``) and
    # the original detail substring (``no API key``) — a regression that
    # dropped ``str(exc)`` and left only the class name is caught.
    assert "ValueError" in result["message"]
    assert "no API key" in result["message"]


def test_generate_a2ui_no_tool_call_returns_full_error_shape():
    """LLM responded but emitted no tool call → a2ui_no_tool_call."""
    fake_llm = MagicMock()
    fake_llm.chat.return_value = _llm_response(tool_calls=None, function_call=None)
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_no_tool_call"


def test_generate_a2ui_empty_tool_calls_returns_full_error_shape():
    """``oai_tool_calls`` was an empty list → a2ui_no_tool_call."""
    fake_llm = MagicMock()
    fake_llm.chat.return_value = _llm_response(tool_calls=[], function_call=None)
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_no_tool_call"


def test_generate_a2ui_invalid_arguments_returns_full_error_shape():
    """Arguments that are a str but NOT valid JSON → a2ui_invalid_arguments."""
    fake_llm = MagicMock()
    fake_llm.chat.return_value = _llm_response(
        tool_calls=[_oai_tool_call(arguments="not json {{{")]
    )
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_invalid_arguments"


def test_generate_a2ui_non_dict_arguments_returns_full_error_shape():
    """Arguments valid JSON but not a dict (e.g. a list) →
    a2ui_invalid_arguments (build_a2ui_operations_from_tool_call expects
    a dict and we must not let the TypeError escape)."""
    fake_llm = MagicMock()
    fake_llm.chat.return_value = _llm_response(
        tool_calls=[_oai_tool_call(arguments=[1, 2, 3])]
    )
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_invalid_arguments"


@pytest.mark.parametrize(
    "exc_cls,exc_args",
    [
        (KeyError, ("missing surfaceId",)),
        (TypeError, ("nope",)),
        (ValueError, ("bad value",)),
    ],
)
def test_build_a2ui_operations_wrapper_catches_expected_errors(exc_cls, exc_args):
    """``build_a2ui_operations_from_tool_call`` raising any of the three
    expected classes (``KeyError`` / ``TypeError`` / ``ValueError``) on
    malformed args must wrap into ``a2ui_invalid_arguments`` rather than
    propagate. Parametrized so the three near-identical bodies don't drift
    (previously copy-pasted, which is exactly how one of the branches would
    silently fall out of sync on a refactor).
    """
    fake_llm = MagicMock()
    args = {
        "surfaceId": "s",
        "catalogId": "copilotkit://app-dashboard-catalog",
        "components": [{"id": "root", "type": "Container"}],
    }
    fake_llm.chat.return_value = _llm_response(
        tool_calls=[_oai_tool_call(arguments=args)]
    )
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm), patch(
        "agents.agent.build_a2ui_operations_from_tool_call",
        side_effect=exc_cls(*exc_args),
    ):
        result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_invalid_arguments"


def test_build_a2ui_operations_boundary_validates_return_shape():
    """Even on the happy path, ``build_a2ui_operations_from_tool_call`` can
    theoretically drift and return a dict missing the ``a2ui_operations``
    key (e.g. upstream schema change). The planner MUST boundary-validate
    the return shape and surface a structured ``a2ui_invalid_arguments``
    rather than propagate the malformed dict to the frontend."""
    fake_llm = MagicMock()
    args = {
        "surfaceId": "s",
        "catalogId": "copilotkit://app-dashboard-catalog",
        "components": [{"id": "root", "type": "Container"}],
    }
    fake_llm.chat.return_value = _llm_response(
        tool_calls=[_oai_tool_call(arguments=args)]
    )
    # Patch the builder to return a malformed dict lacking "a2ui_operations".
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm), patch(
        "agents.agent.build_a2ui_operations_from_tool_call",
        return_value={"unexpected_key": "foo"},
    ):
        result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_invalid_arguments"


# ---------------------------------------------------------------------------
# Programmer errors MUST propagate — not be silently swallowed.
# The narrow re-raise tuple is (AttributeError, TypeError, NameError,
# ImportError, ModuleNotFoundError, AssertionError, NotImplementedError,
# pydantic.ValidationError).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "exc_cls,exc_args",
    [
        (AttributeError, ("typo",)),
        (TypeError, ("bad kwargs",)),
        (NameError, ("unknown name",)),
        (ImportError, ("bad import",)),
        (ModuleNotFoundError, ("no module",)),
        (AssertionError, ("assertion",)),
        (NotImplementedError, ("todo",)),
    ],
)
def test_generate_a2ui_lets_programmer_errors_propagate(exc_cls, exc_args):
    """Programmer-error exception classes must propagate uncaught rather
    than being wrapped as ``a2ui_llm_error``. Keeps genuine bugs visible
    in tests and server logs instead of silently masked."""
    fake_llm = MagicMock()
    fake_llm.chat.side_effect = exc_cls(*exc_args)
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        with pytest.raises(exc_cls):
            generate_a2ui_via_llm(context="")


def test_generate_a2ui_propagates_pydantic_validation_error():
    """``pydantic.ValidationError`` indicates a schema bug (the planner's
    response could not be validated against the expected model), not a
    transport failure. It must propagate rather than be wrapped as
    ``a2ui_llm_error`` — the remediation for a schema bug is not "verify
    provider credentials"."""
    from pydantic import BaseModel, ValidationError

    class _Dummy(BaseModel):
        x: int

    # Trigger a real ValidationError so we have a legitimate instance to
    # raise — constructing ValidationError directly is tricky across
    # pydantic versions.
    try:
        _Dummy(x="not-an-int")  # type: ignore[arg-type]
    except ValidationError as ve:
        real_ve = ve
    else:  # pragma: no cover - defensive
        pytest.fail("expected pydantic to raise ValidationError")

    fake_llm = MagicMock()
    fake_llm.chat.side_effect = real_ve
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        with pytest.raises(ValidationError):
            generate_a2ui_via_llm(context="")


@pytest.mark.parametrize(
    "exc_cls,exc_args",
    [
        (KeyError, ("missing",)),
        (IndexError, ("out of range",)),
        (RecursionError, ("too deep",)),
        (MemoryError, ()),
        (LookupError, ("lookup",)),
    ],
)
def test_generate_a2ui_wraps_recoverable_errors_into_llm_error(exc_cls, exc_args):
    """``KeyError`` / ``IndexError`` / ``LookupError`` / ``RecursionError`` /
    ``MemoryError`` are raised by SDK/adapter code as recoverable conditions
    on malformed provider payloads. They used to propagate, but the narrowed
    re-raise tuple now lets them fall through into the transport-error path
    so callers get the structured ``a2ui_llm_error`` surface with the
    correct "retry / verify provider" remediation rather than an uncaught
    500."""
    fake_llm = MagicMock()
    fake_llm.chat.side_effect = exc_cls(*exc_args)
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_llm_error"


def test_generate_a2ui_memory_error_without_args_produces_classname_only_message():
    """``MemoryError()`` carries no args, so ``str(exc) == ""``. The source's
    ``exc_detail = str(exc)[:200] if str(exc) else ""`` branch drops the
    trailing ``: <detail>`` segment, so the message must be exactly
    ``"Secondary A2UI LLM call failed: MemoryError"`` with no trailing
    colon. Pinning this catches a regression that always appends ``:`` even
    when detail is empty (which would produce ``"...: MemoryError: "`` and
    look subtly broken in the frontend)."""
    fake_llm = MagicMock()
    fake_llm.chat.side_effect = MemoryError()
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_llm_error"
    assert result["message"] == "Secondary A2UI LLM call failed: MemoryError", (
        f"empty-detail path must produce classname-only message (no trailing "
        f"': '); got {result['message']!r}"
    )


# ---------------------------------------------------------------------------
# _get_a2ui_llm: model resolution + keyed memoization + provider-agnostic
# ---------------------------------------------------------------------------


def test_a2ui_model_env_overrides_langroid_model(monkeypatch):
    """When ``A2UI_MODEL`` is set, the planner LLM must use it regardless
    of ``LANGROID_MODEL``."""
    monkeypatch.setenv("LANGROID_MODEL", "gpt-4.1")
    monkeypatch.setenv("A2UI_MODEL", "anthropic/claude-opus-4")

    captured_models: list[str] = []

    class _FakeLLM:
        def __init__(self, config):
            captured_models.append(config.chat_model)

        def chat(self, *_a, **_kw):
            return _llm_response(tool_calls=None)

    with patch("agents.agent.lm.OpenAIGPT", _FakeLLM):
        # Drive through the public path so model resolution runs.
        generate_a2ui_via_llm(context="")

    assert captured_models == ["anthropic/claude-opus-4"], (
        f"A2UI_MODEL should win; got {captured_models!r}"
    )


def test_langroid_model_used_when_a2ui_model_unset(monkeypatch):
    """When only ``LANGROID_MODEL`` is set, the planner LLM should inherit
    it — same provider as the primary chat agent."""
    monkeypatch.setenv("LANGROID_MODEL", "anthropic/claude-opus-4")

    captured_models: list[str] = []

    class _FakeLLM:
        def __init__(self, config):
            captured_models.append(config.chat_model)

        def chat(self, *_a, **_kw):
            return _llm_response(tool_calls=None)

    with patch("agents.agent.lm.OpenAIGPT", _FakeLLM):
        generate_a2ui_via_llm(context="")

    assert captured_models == ["anthropic/claude-opus-4"]


def test_default_model_when_no_env_set(monkeypatch):
    """With neither ``A2UI_MODEL`` nor ``LANGROID_MODEL`` set, the default
    chat_model must match the primary agent's default (``gpt-4.1``
    as documented in ``create_agent``). Pinning the string here catches a
    silent drift between the planner default and the primary default.

    Explicit ``monkeypatch.delenv`` on both vars (belt-and-suspenders
    alongside the autouse ``_clean_env`` fixture) so a future refactor of
    the fixture can't accidentally leak a stray env var into this test.
    """
    monkeypatch.delenv("A2UI_MODEL", raising=False)
    monkeypatch.delenv("LANGROID_MODEL", raising=False)
    captured_models: list[str] = []

    class _FakeLLM:
        def __init__(self, config):
            captured_models.append(config.chat_model)

        def chat(self, *_a, **_kw):
            return _llm_response(tool_calls=None)

    with patch("agents.agent.lm.OpenAIGPT", _FakeLLM):
        generate_a2ui_via_llm(context="")

    assert captured_models == ["gpt-4.1"]


def test_llm_memoization_returns_same_instance_for_same_model():
    """Two calls with the same resolved model must return the same LLM
    instance — rebuilding is wasted work and re-runs credential resolution."""
    sentinel = MagicMock()
    with patch("agents.agent.lm.OpenAIGPT", return_value=sentinel) as mock_cls:
        first = _get_a2ui_llm("gpt-4.1")
        second = _get_a2ui_llm("gpt-4.1")
    assert first is second is sentinel
    assert mock_cls.call_count == 1


def test_llm_memoization_is_keyed_per_model():
    """Different model strings must produce different instances, and each
    call must construct ``OpenAIGPT`` with the exact model string passed."""
    instances: list[MagicMock] = []
    captured_models: list[str] = []

    class _FakeLLM:
        def __init__(self, config):
            captured_models.append(config.chat_model)
            instances.append(self)  # type: ignore[arg-type]

        def chat(self, *_a, **_kw):  # pragma: no cover - not used here
            return _llm_response(tool_calls=None)

    with patch("agents.agent.lm.OpenAIGPT", _FakeLLM):
        a = _get_a2ui_llm("gpt-4.1")
        b = _get_a2ui_llm("anthropic/claude-opus-4")
        a2 = _get_a2ui_llm("gpt-4.1")

    assert a is not b, "different models must produce different instances"
    assert a is a2, "repeated calls for same model must hit the cache"
    assert captured_models == ["gpt-4.1", "anthropic/claude-opus-4"]


@pytest.mark.skipif(
    not os.environ.get("LANGROID_INTEGRATION_TESTS"),
    reason=(
        "Integration test: constructs real lm.OpenAIGPT. Set "
        "LANGROID_INTEGRATION_TESTS=1 to enable."
    ),
)
def test_construction_succeeds_without_openai_env_real_openaigpt(monkeypatch):
    """Regression guard (strong form): with ``LANGROID_MODEL=anthropic/...``
    set and NO ``OPENAI_*`` env variables, constructing the REAL
    ``lm.OpenAIGPT`` must not raise.

    This is the whole point of the provider-agnostic fix. langroid's
    ``OpenAIGPT`` class dispatches to the right provider based on the
    ``provider/model`` prefix; only that provider's credentials are
    required at construction time. Construction should be pure (config +
    env reads, no network), so calling it against an Anthropic-prefixed
    model with only ``ANTHROPIC_API_KEY`` set should succeed without
    requiring any OpenAI-specific env.

    Opt-in (``LANGROID_INTEGRATION_TESTS=1``) because langroid's
    ``OpenAIGPT.__init__`` has historically flirted with network / provider
    init; we keep the weaker model-string routing test (below) as the
    always-on unit-level line of defense.
    """
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.setenv("LANGROID_MODEL", "anthropic/claude-opus-4")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    import langroid.language_models as lm  # noqa: WPS433 — local import by design

    # Construct directly — this is the regression we're actually guarding.
    try:
        config = lm.OpenAIGPTConfig(
            chat_model="anthropic/claude-opus-4",
            stream=False,
        )
        llm = lm.OpenAIGPT(config)
    except Exception as exc:  # pragma: no cover - explicit failure path
        pytest.fail(
            f"OpenAIGPT construction must not require OpenAI env when model is "
            f"non-OpenAI; got {type(exc).__name__}: {exc}"
        )
    assert llm is not None


def test_construction_uses_correct_model_string_for_non_openai(monkeypatch):
    """Supplementary model-string routing test: with a non-OpenAI
    ``LANGROID_MODEL``, the planner constructs an ``OpenAIGPT`` with the
    exact model string. This is the weaker cousin of the strong-form
    regression guard above — it confirms the routing path even if the real
    constructor becomes impossible to unit-test (e.g. adds network I/O)."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.setenv("LANGROID_MODEL", "anthropic/claude-opus-4")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    captured_models: list[str] = []

    class _FakeLLM:
        def __init__(self, config):
            captured_models.append(config.chat_model)

        def chat(self, *_a, **_kw):
            return _llm_response(tool_calls=None)

    with patch("agents.agent.lm.OpenAIGPT", _FakeLLM):
        generate_a2ui_via_llm(context="")

    assert captured_models == ["anthropic/claude-opus-4"]


def test_agent_module_imports_cleanly_without_openai_env(tmp_path):
    """Honest import-time regression guard: importing ``agents.agent`` with
    no OpenAI-specific env must succeed. This catches any top-level
    ``openai.OpenAI()`` / ``openai.Client()`` call that would re-introduce
    a hard provider dependency.

    Runs in a SUBPROCESS so module-level state (specifically the
    ``_get_a2ui_llm`` ``lru_cache`` and any other module-scope singletons)
    in the parent interpreter is not perturbed by a reload. Previously we
    used ``importlib.reload`` which rebinds module-level function
    identities — downstream tests patching by name would then silently see
    a stale reference and leak state across tests. Subprocess isolation
    makes this test order-independent.
    """
    # Strip any OPENAI_* / LANGROID_* / A2UI_* env vars the child would
    # otherwise inherit, but keep everything else (PATH, HOME, etc.) so the
    # interpreter can actually start.
    env = {
        k: v for k, v in os.environ.items()
        if not k.startswith(("OPENAI_", "LANGROID_", "A2UI_"))
    }
    # Ensure the child can import ``agents.agent`` via the package's src/
    # directory — mirrors what conftest.py does for the parent.
    # Also include the integration root so the ``tools`` symlink (which
    # lives at ``langroid/tools`` → ``../../shared/python/tools``) is
    # importable — mirrors the ``PYTHONPATH=".:src:..."`` that the CI
    # workflow and ``package.json`` dev script both set.
    pkg_root = Path(__file__).resolve().parents[2]
    src_dir = pkg_root / "src"
    existing_pp = env.get("PYTHONPATH", "")
    new_pp = f"{pkg_root}{os.pathsep}{src_dir}"
    env["PYTHONPATH"] = (
        f"{new_pp}{os.pathsep}{existing_pp}" if existing_pp else new_pp
    )

    # Run the import from ``tmp_path`` so any stray ``.env`` file in the
    # project root isn't auto-loaded by ``dotenv.load_dotenv`` (which would
    # reintroduce OPENAI_* silently and mask a regression).
    result = subprocess.run(
        [sys.executable, "-c", "import agents.agent"],
        env=env,
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"import agents.agent failed in clean subprocess:\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )


# ---------------------------------------------------------------------------
# GenerateA2UITool.handle delegates to generate_a2ui_via_llm
# ---------------------------------------------------------------------------


def test_generate_a2ui_tool_handle_returns_json_str_of_operations():
    """``GenerateA2UITool.handle`` is what langroid invokes server-side. It
    must return a JSON string of whatever ``generate_a2ui_via_llm`` returned
    (a2ui_operations dict on success, or an error dict on failure)."""
    happy_result = {"a2ui_operations": [{"type": "create_surface"}]}
    with patch(
        "agents.agent.generate_a2ui_via_llm", return_value=happy_result
    ) as stub:
        tool = GenerateA2UITool(context="whatever")
        out = tool.handle()
    stub.assert_called_once_with(context="whatever")
    assert isinstance(out, str), (
        f"handle() must return str for langroid's tool framework; got "
        f"{type(out).__name__}"
    )
    parsed = json.loads(out)
    assert parsed == happy_result


def test_generate_a2ui_tool_handle_surfaces_error_dicts_verbatim():
    """Errors from generate_a2ui_via_llm must be serialized to JSON verbatim
    so the frontend / outer LLM can show the structured error."""
    err = {"error": "a2ui_llm_error", "message": "x", "remediation": "y"}
    with patch("agents.agent.generate_a2ui_via_llm", return_value=err):
        tool = GenerateA2UITool(context="")
        out = tool.handle()
    assert isinstance(out, str)
    parsed = json.loads(out)
    assert parsed == err


def test_generate_a2ui_tool_handle_wraps_json_dumps_failure():
    """If ``generate_a2ui_via_llm`` returns something with a non-JSON-serializable
    value (e.g. a ``set`` leaked in from an upstream bug), ``handle()``
    must NOT propagate the ``TypeError`` to the langroid tool framework.
    Instead it emits a JSON-encoded structured error string so the outer
    agent sees a recognizable failure shape.

    Uses ``{1, 2, 3}`` (a set) because it is unambiguously non-JSON-
    serializable and — unlike ``datetime.utcnow()`` — does not depend on a
    deprecated stdlib API.
    """
    unserializable = {"a2ui_operations": [{"payload": {1, 2, 3}}]}
    with patch("agents.agent.generate_a2ui_via_llm", return_value=unserializable):
        tool = GenerateA2UITool(context="")
        out = tool.handle()
    # Must still be a str that json.loads accepts.
    parsed = json.loads(out)
    _assert_full_error_shape(parsed)


# ---------------------------------------------------------------------------
# Module hygiene: no top-level openai import (including inside top-level
# try/except blocks, conditional imports, etc. — anywhere that runs at
# module load time).
# ---------------------------------------------------------------------------


def _module_level_ancestors(tree: ast.Module) -> dict[int, bool]:
    """Return a map ``id(node) -> is_module_level``.

    A node is module-level iff the chain of containing nodes from the
    module root never passes through a ``FunctionDef`` / ``AsyncFunctionDef``.
    Top-level ``Try`` / ``If`` / ``With`` / ``ClassDef`` blocks DO count as
    module-level — their bodies execute at import time. A regression that
    drops an ``import openai`` into a class body (e.g. default-factory
    attribute, metaclass setup) must be caught here too.
    """
    is_module_level: dict[int, bool] = {}

    def _walk(node: ast.AST, inside_func: bool) -> None:
        # Any import statement encountered here gets tagged. We don't need
        # every node, just the imports — but walking uniformly keeps the
        # logic simple.
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            is_module_level[id(node)] = not inside_func
        # Recurse, flipping the flag only when we enter a function body
        # (its code runs on call, not at import time). Class bodies execute
        # at module load, so we intentionally do NOT flip the flag for
        # ``ClassDef``.
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for child in ast.iter_child_nodes(node):
                _walk(child, inside_func=True)
        else:
            for child in ast.iter_child_nodes(node):
                _walk(child, inside_func=inside_func)

    _walk(tree, inside_func=False)
    return is_module_level


def test_agent_module_does_not_import_openai_at_module_load_time():
    """The provider-agnostic fix requires that importing ``agents.agent``
    does not pull in the ``openai`` SDK. A module-load-time ``import openai``
    — whether at the top of the file, inside a top-level ``try/except``, or
    inside a top-level ``if``/``with``/etc — would reintroduce the
    hard-coded provider dependency we just removed.

    The previous walker only inspected ``tree.body``, missing imports
    nested inside a ``try: import openai; except: pass`` pattern (which
    still runs at module import). This version walks the full AST and
    flags any import whose execution path is NOT guarded by a
    ``FunctionDef`` / ``AsyncFunctionDef`` / ``ClassDef`` body.
    """
    import agents.agent as mod

    source = inspect.getsource(mod)
    tree = ast.parse(source)
    is_module_level = _module_level_ancestors(tree)

    for node in ast.walk(tree):
        if not isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        if not is_module_level.get(id(node), False):
            continue  # inside a function / class body → fine, lazy
        if isinstance(node, ast.ImportFrom):
            if node.module and node.module.startswith("openai"):
                raise AssertionError(
                    f"agents.agent must not `from openai ...` at module load "
                    f"time (line {node.lineno}); found: from {node.module} import ..."
                )
        else:  # ast.Import
            for alias in node.names:
                if alias.name.startswith("openai"):
                    raise AssertionError(
                        f"agents.agent must not `import openai` at module load "
                        f"time (line {node.lineno}); found: {alias.name}"
                    )


# ---------------------------------------------------------------------------
# Logger assertions — every logger.exception / logger.warning call in source
# should have a corresponding caplog assertion here. Message substrings are
# pinned so an unrelated future WARN doesn't silently satisfy the assertion.
# ---------------------------------------------------------------------------


def test_multi_tool_call_picks_first_and_warns(caplog):
    """When the planner returns more than one tool call (some providers do
    this under certain conditions), the code must pick ``[0]`` and emit a
    WARN log about dropping the tail. Never silently consume N>1.

    Pin the message substring (``"2 tool calls"`` — source formats the
    count via ``%d``) so an unrelated future WARN can't satisfy this
    assertion.
    """
    fake_llm = MagicMock()
    args_first = {
        "surfaceId": "first",
        "catalogId": "copilotkit://app-dashboard-catalog",
        "components": [{"id": "root", "type": "Container"}],
    }
    args_second = {
        "surfaceId": "second",
        "catalogId": "copilotkit://app-dashboard-catalog",
        "components": [{"id": "root", "type": "Container"}],
    }
    fake_llm.chat.return_value = _llm_response(
        tool_calls=[
            _oai_tool_call(arguments=args_first, call_id="c1"),
            _oai_tool_call(arguments=args_second, call_id="c2"),
        ]
    )
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        with caplog.at_level(logging.WARNING, logger="agents.agent"):
            result = generate_a2ui_via_llm(context="")

    assert "a2ui_operations" in result
    assert result["a2ui_operations"][0]["surfaceId"] == "first", (
        "must pick tool_calls[0] when multiple are present"
    )
    # The FIRST call's args lack ``data``, so the op list should be exactly
    # 2 (surface + components) — NOT 4 (which would indicate both calls
    # were processed and concatenated). Pinning the count catches a
    # regression that silently processes all calls.
    assert len(result["a2ui_operations"]) == 2, (
        f"expected 2 ops from first tool_call's args only; got "
        f"{len(result['a2ui_operations'])}"
    )
    assert any(
        rec.levelno == logging.WARNING
        and rec.name == "agents.agent"
        and "2 tool calls" in rec.getMessage()
        for rec in caplog.records
    ), (
        f"expected WARN mentioning '2 tool calls'; got "
        f"{[(r.name, r.levelname, r.getMessage()) for r in caplog.records]}"
    )


def test_tool_call_missing_function_attr_falls_through_to_legacy_path(caplog):
    """Degraded-shape: ``tool_calls=[call]`` where ``call.function`` is
    ``None``. The code must fall through to the legacy ``function_call``
    path rather than raising ``AttributeError``, and emit a WARN pinpointing
    the drift so operators see it in logs.

    Pin the message substring (``".function is None"``) so the caplog
    assertion can't silently pass on an unrelated future WARN.
    """
    fake_llm = MagicMock()
    degraded = _FakeOaiToolCall(id="c1", function=None)
    args = {
        "surfaceId": "legacy-via-fallthrough",
        "catalogId": "copilotkit://app-dashboard-catalog",
        "components": [{"id": "root", "type": "Container"}],
    }
    fake_llm.chat.return_value = _llm_response(
        tool_calls=[degraded],
        function_call=_function_call(arguments=args),
    )
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        with caplog.at_level(logging.WARNING, logger="agents.agent"):
            result = generate_a2ui_via_llm(context="")
    assert "a2ui_operations" in result
    assert result["a2ui_operations"][0]["surfaceId"] == "legacy-via-fallthrough"
    assert any(
        rec.levelno == logging.WARNING
        and rec.name == "agents.agent"
        and ".function is None" in rec.getMessage()
        for rec in caplog.records
    ), (
        f"expected WARN mentioning '.function is None'; got "
        f"{[(r.name, r.levelname, r.getMessage()) for r in caplog.records]}"
    )


def test_tool_call_with_function_arguments_none_falls_through_to_legacy_path(caplog):
    """Symmetric fallthrough: ``tool_calls[0].function`` is present but its
    ``arguments`` is ``None``. The modern slot has no args, so the code
    must fall through to the legacy ``function_call`` path (some providers
    put the forced call in the legacy slot even when the modern slot is
    half-populated).

    This is symmetric with the ``function is None`` fallthrough above —
    before the source fix, the modern slot returned ``None`` eagerly and
    this case was misclassified as ``a2ui_no_tool_call``.

    Pin the WARN substring (``".arguments is None"``) so the assertion
    doesn't silently pass on an unrelated future WARN.
    """
    fake_llm = MagicMock()
    # Modern slot: function present, but arguments is None (degraded shape).
    modern_no_args = _FakeOaiToolCall(
        id="c1",
        function=_FakeFunction(name="render_a2ui", arguments=None),
    )
    legacy_args = {
        "surfaceId": "legacy-surface",
        "catalogId": "copilotkit://app-dashboard-catalog",
        "components": [{"id": "root", "type": "Container"}],
    }
    fake_llm.chat.return_value = _llm_response(
        tool_calls=[modern_no_args],
        function_call=_function_call(arguments=legacy_args),
    )
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        with caplog.at_level(logging.WARNING, logger="agents.agent"):
            result = generate_a2ui_via_llm(context="")
    assert "a2ui_operations" in result
    assert result["a2ui_operations"][0]["surfaceId"] == "legacy-surface"
    # Tight substring: pin the MODERN-slot warning specifically. The legacy-
    # slot warning ("function_call present but .arguments is None") also
    # contains ".arguments is None" — a regression that swaps which warning
    # fires would pass with the looser substring.
    assert any(
        rec.levelno == logging.WARNING
        and rec.name == "agents.agent"
        and "tool_call.function present but .arguments is None" in rec.getMessage()
        for rec in caplog.records
    ), (
        f"expected WARN mentioning 'tool_call.function present but .arguments is None'; got "
        f"{[(r.name, r.levelname, r.getMessage()) for r in caplog.records]}"
    )


def test_tool_call_with_function_missing_arguments_returns_invalid_arguments(caplog):
    """Degraded-shape: ``tool_calls[0].function`` exists but has no
    ``arguments`` attr AND there is no legacy ``function_call`` fallback.

    The updated source distinguishes this case from "no tool call at all":
    the planner DID produce a tool-call shape, just with no args payload,
    so the ``_extract_tool_call_arguments`` helper surfaces ``_ARGS_MISSING``
    and the caller emits ``a2ui_invalid_arguments`` (not
    ``a2ui_no_tool_call``) — "supports forced function-calling" would be
    the wrong remediation since the planner clearly did try.

    Pin the full MODERN-slot WARN substring (``"tool_call.function present
    but .arguments is None"``) instead of the loose ``".arguments is None"``
    — the legacy-slot WARN (``"function_call present but .arguments is
    None"``) also contains ``.arguments is None``, and a regression that
    swaps which WARN fires would pass the loose assertion.
    """
    fake_llm = MagicMock()
    # SimpleNamespace with no `arguments` attr — getattr returns None.
    degraded_func = SimpleNamespace(name="render_a2ui")
    degraded_call = _FakeOaiToolCall(id="c1", function=degraded_func)
    fake_llm.chat.return_value = _llm_response(tool_calls=[degraded_call])
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        with caplog.at_level(logging.WARNING, logger="agents.agent"):
            result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_invalid_arguments", (
        f"modern slot present with arguments=None and no legacy fallback "
        f"must surface a2ui_invalid_arguments (via _ARGS_MISSING sentinel); "
        f"got {result['error']!r}"
    )
    assert any(
        rec.levelno == logging.WARNING
        and rec.name == "agents.agent"
        and "tool_call.function present but .arguments is None" in rec.getMessage()
        for rec in caplog.records
    ), (
        f"expected WARN mentioning 'tool_call.function present but .arguments is None'; got "
        f"{[(r.name, r.levelname, r.getMessage()) for r in caplog.records]}"
    )


def test_no_tool_call_warn_log(caplog):
    """``a2ui_no_tool_call`` branch must log a WARNING so operators see the
    planner drift in logs. Pin the substring ``"did not emit"`` from the
    source's WARN message."""
    fake_llm = MagicMock()
    fake_llm.chat.return_value = _llm_response(tool_calls=None, function_call=None)
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        with caplog.at_level(logging.WARNING, logger="agents.agent"):
            result = generate_a2ui_via_llm(context="")
    assert result["error"] == "a2ui_no_tool_call"
    assert any(
        rec.levelno == logging.WARNING
        and rec.name == "agents.agent"
        and "did not emit" in rec.getMessage()
        for rec in caplog.records
    ), (
        f"expected WARN mentioning 'did not emit'; got "
        f"{[(r.name, r.levelname, r.getMessage()) for r in caplog.records]}"
    )


def test_legacy_function_call_with_none_arguments_warns_and_returns_invalid_arguments(caplog):
    """Legacy-slot fallthrough: ``function_call`` is present but its
    ``arguments`` attr is ``None``. The updated source emits a WARN and
    surfaces ``_ARGS_MISSING`` → ``a2ui_invalid_arguments`` (symmetric with
    the modern slot's degraded-shape path). Distinct from
    ``a2ui_no_tool_call``: the planner DID emit a tool-call shape, just
    with no args payload.

    Pin the WARN substring (``"function_call present but .arguments is
    None"``) so an unrelated future WARN can't silently satisfy the
    assertion.
    """
    fake_llm = MagicMock()
    # Modern slot absent; legacy slot present with arguments=None.
    fake_llm.chat.return_value = _llm_response(
        tool_calls=None,
        function_call=_function_call(arguments=None),
    )
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm):
        with caplog.at_level(logging.WARNING, logger="agents.agent"):
            result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_invalid_arguments", (
        f"legacy slot with arguments=None must surface a2ui_invalid_arguments "
        f"(via _ARGS_MISSING sentinel); got {result['error']!r}"
    )
    assert any(
        rec.levelno == logging.WARNING
        and rec.name == "agents.agent"
        and "function_call present but .arguments is None" in rec.getMessage()
        for rec in caplog.records
    ), (
        f"expected WARN mentioning 'function_call present but .arguments is None'; "
        f"got {[(r.name, r.levelname, r.getMessage()) for r in caplog.records]}"
    )


# ---------------------------------------------------------------------------
# _resolve_a2ui_model: env-var precedence contract
# ---------------------------------------------------------------------------


def test_resolve_a2ui_precedence(monkeypatch):
    """``A2UI_MODEL`` must win over ``LANGROID_MODEL`` — the planner-only
    override is the whole point of that env var."""
    monkeypatch.setenv("A2UI_MODEL", "anthropic/claude-opus-4")
    monkeypatch.setenv("LANGROID_MODEL", "gpt-4.1")
    assert _resolve_a2ui_model() == "anthropic/claude-opus-4"


def test_resolve_a2ui_empty_a2ui_falls_through(monkeypatch):
    """Empty-string ``A2UI_MODEL`` (e.g. operator typed ``A2UI_MODEL=``
    without a value) must fall through to ``LANGROID_MODEL`` rather than
    freezing the planner into the empty string. ``os.getenv`` returns ``""``
    (not ``None``) in this case, and the source relies on ``or``'s
    falsy-fallthrough semantics for the empty-string case.
    """
    monkeypatch.setenv("A2UI_MODEL", "")
    monkeypatch.setenv("LANGROID_MODEL", "anthropic/claude-opus-4")
    assert _resolve_a2ui_model() == "anthropic/claude-opus-4"


def test_resolve_a2ui_default(monkeypatch):
    """With no env vars set at all, the resolver returns the documented
    default ``gpt-4.1``. Pinning the string here catches a silent
    drift between the planner default and ``create_agent``'s default.
    """
    monkeypatch.delenv("A2UI_MODEL", raising=False)
    monkeypatch.delenv("LANGROID_MODEL", raising=False)
    assert _resolve_a2ui_model() == "gpt-4.1"


# ---------------------------------------------------------------------------
# _get_a2ui_llm LRU eviction: maxsize=4 must evict LRU entry on 5th distinct
# model. Documented behavior in the source block comment — unpinned until now.
# ---------------------------------------------------------------------------


def test_llm_cache_evicts_after_maxsize():
    """After ``maxsize=4`` was made explicit, the 5th distinct model evicts
    the least-recently-used entry. The first-inserted model's second call
    must reconstruct a fresh ``OpenAIGPT`` (not hit the cache), observable
    as a second ``__init__`` invocation with the same model string.

    Without this guard, a silent bump of ``maxsize`` to a larger number
    (or to ``None`` / unbounded) wouldn't fail any existing test but would
    change memory semantics in production.
    """
    instances: list[str] = []

    class _FakeLLM:
        def __init__(self, config):
            instances.append(config.chat_model)

    with patch("agents.agent.lm.OpenAIGPT", _FakeLLM):
        # Fill the cache (4 distinct models).
        for i in range(4):
            _get_a2ui_llm(f"provider/m{i}")
        # Insert a 5th — evicts provider/m0 (LRU).
        _get_a2ui_llm("provider/m4")
        # Re-fetching provider/m0 must reconstruct.
        _get_a2ui_llm("provider/m0")

    # provider/m0 appears twice in the construction log: once on initial
    # insert, once after eviction + reconstruct.
    assert instances.count("provider/m0") == 2, (
        f"provider/m0 should have been constructed twice (initial + after "
        f"eviction); got instances={instances!r}"
    )
    # Others constructed exactly once.
    for m in ("provider/m1", "provider/m2", "provider/m3", "provider/m4"):
        assert instances.count(m) == 1, (
            f"{m} should have been constructed once; got instances={instances!r}"
        )


# ---------------------------------------------------------------------------
# Planner LLM must construct with stream=False — load-bearing per source
# block comment (streaming wastes work; we need the full tool call before
# emitting operations). Previously untested.
# ---------------------------------------------------------------------------


def test_planner_llm_constructs_with_stream_false():
    """Capture the ``OpenAIGPTConfig`` passed to the planner LLM and assert
    ``stream is False``. Load-bearing per the source comment; distinct from
    the primary chat agent's config which uses ``stream=True`` for SSE
    streaming to the frontend.
    """
    captured_configs: list[Any] = []

    class _FakeLLM:
        def __init__(self, config):
            captured_configs.append(config)

        def chat(self, *_a, **_kw):
            return _llm_response(tool_calls=None)

    with patch("agents.agent.lm.OpenAIGPT", _FakeLLM):
        generate_a2ui_via_llm(context="")

    assert len(captured_configs) == 1, (
        f"expected one OpenAIGPTConfig construction; got {len(captured_configs)}"
    )
    cfg = captured_configs[0]
    assert cfg.stream is False, (
        f"planner must construct with stream=False (full tool call before "
        f"emitting ops); got stream={cfg.stream!r}"
    )


# ---------------------------------------------------------------------------
# _RENDER_A2UI_FUNCTION_SPEC: pin the schema shape. This is the contract
# between the planner LLM and the frontend renderer; a silent rename of
# required fields would break every downstream consumer.
# ---------------------------------------------------------------------------


def test_render_a2ui_function_spec_required_fields():
    """Pin the forced-function-call spec's name and required-field set.
    These are the contract the planner LLM is forced to obey — renaming
    ``surfaceId`` / ``catalogId`` / ``components`` is a frontend-breaking
    change and must be caught at unit-test time.
    """
    assert _RENDER_A2UI_FUNCTION_SPEC.name == "render_a2ui"
    assert _RENDER_A2UI_FUNCTION_SPEC.parameters["required"] == [
        "surfaceId",
        "catalogId",
        "components",
    ]


# ---------------------------------------------------------------------------
# Tuple annotations: BACKEND_TOOLS / FRONTEND_TOOLS / ALL_TOOLS
# ---------------------------------------------------------------------------


def test_tool_tuples_contain_only_tool_message_subclasses():
    """All entries in ``BACKEND_TOOLS`` / ``FRONTEND_TOOLS`` / ``ALL_TOOLS``
    must be ``ToolMessage`` subclasses (not instances, not random strings).
    Pins the ``tuple[type[ToolMessage], ...]`` annotation shape at runtime —
    a regression that slipped a stringified tool name into the tuple would
    pass mypy on some configurations but fail at langroid registration.
    """
    for tools_tuple, label in (
        (BACKEND_TOOLS, "BACKEND_TOOLS"),
        (FRONTEND_TOOLS, "FRONTEND_TOOLS"),
        (ALL_TOOLS, "ALL_TOOLS"),
    ):
        assert isinstance(tools_tuple, tuple), f"{label} must be a tuple"
        for entry in tools_tuple:
            assert isinstance(entry, type) and issubclass(entry, ToolMessage), (
                f"{label} must contain only ToolMessage subclasses; got {entry!r}"
            )

    # ALL_TOOLS = BACKEND_TOOLS + FRONTEND_TOOLS — count pin so a new tool
    # not wired into ALL_TOOLS gets caught here too.
    assert len(ALL_TOOLS) == len(BACKEND_TOOLS) + len(FRONTEND_TOOLS)
    assert len(ALL_TOOLS) == 9, (
        f"ALL_TOOLS should have 9 entries (6 backend + 3 frontend); got "
        f"{len(ALL_TOOLS)}"
    )


# ---------------------------------------------------------------------------
# Backend tool handle() try/except wrappers — each of the 6 backend tools
# wraps its ``*_impl()`` call. Parametrized happy + error paths.
# ---------------------------------------------------------------------------


# (tool_cls, impl_symbol_on_agent_module, tool_ctor_kwargs, error_code)
_BACKEND_TOOL_CASES = [
    (GetWeatherTool, "get_weather_impl", {"location": "Seattle"}, "get_weather_failed"),
    (QueryDataTool, "query_data_impl", {"query": "show sales"}, "query_data_failed"),
    (
        ManageSalesTodosTool,
        "manage_sales_todos_impl",
        {"todos": []},
        "manage_sales_todos_failed",
    ),
    (
        GetSalesTodosTool,
        "get_sales_todos_impl",
        {},
        "get_sales_todos_failed",
    ),
    (
        ScheduleMeetingTool,
        "schedule_meeting_impl",
        {"reason": "demo", "duration_minutes": 30},
        "schedule_meeting_failed",
    ),
    (
        SearchFlightsTool,
        "search_flights_impl",
        {"flights": []},
        "search_flights_failed",
    ),
]


@pytest.mark.parametrize(
    "tool_cls,impl_name,kwargs,_error_code",
    _BACKEND_TOOL_CASES,
    ids=[c[0].__name__ for c in _BACKEND_TOOL_CASES],
)
def test_backend_tool_handle_happy_path(tool_cls, impl_name, kwargs, _error_code):
    """Happy-path: each backend tool's ``handle()`` serializes the result of
    its wrapped ``*_impl()`` to a JSON string. Patches the impl symbol on
    ``agents.agent`` (where it's bound at import time) so we control the
    return value without depending on shared/python's actual implementation.
    """
    sentinel_result = {"ok": True, "tool": tool_cls.__name__}
    with patch(f"agents.agent.{impl_name}", return_value=sentinel_result):
        tool = tool_cls(**kwargs)
        out = tool.handle()
    assert isinstance(out, str)
    assert json.loads(out) == sentinel_result


@pytest.mark.parametrize(
    "tool_cls,impl_name,kwargs,error_code",
    _BACKEND_TOOL_CASES,
    ids=[c[0].__name__ for c in _BACKEND_TOOL_CASES],
)
def test_backend_tool_handle_error_path_returns_structured_error(
    tool_cls, impl_name, kwargs, error_code, caplog
):
    """Error-path: each backend tool must wrap an impl exception into the
    structured ``_tool_error`` JSON shape (``{"error": "<tool>_failed",
    "message": "ValueError: simulated"}``). The exception must NOT escape
    into langroid's tool-handling stack.

    Also asserts the module logger emits an ERROR record (from
    ``logger.exception(...)`` in the handler).
    """
    with patch(f"agents.agent.{impl_name}", side_effect=ValueError("simulated")):
        tool = tool_cls(**kwargs)
        with caplog.at_level(logging.ERROR, logger="agents.agent"):
            out = tool.handle()
    assert isinstance(out, str)
    parsed = json.loads(out)
    assert parsed["error"] == error_code
    # Message includes the class name AND the detail substring — both halves
    # are load-bearing for operator diagnosis.
    assert "ValueError" in parsed["message"]
    assert "simulated" in parsed["message"]
    # Error record logged on agents.agent.
    assert any(
        rec.levelno >= logging.ERROR and rec.name == "agents.agent"
        for rec in caplog.records
    ), (
        f"expected ERROR log on agents.agent from {tool_cls.__name__}.handle; "
        f"got {[(r.name, r.levelname) for r in caplog.records]}"
    )


# ---------------------------------------------------------------------------
# GenerateA2UITool.handle: json.dumps wrapper must catch every exception
# class raised by ``json.dumps`` on pathological inputs. Source catches
# ``(TypeError, ValueError, OverflowError, RecursionError)`` — each branch
# gets its own test so a regression that narrows the tuple is caught.
# ---------------------------------------------------------------------------


def test_tool_handle_wraps_value_error_on_circular_reference():
    """A cyclic dict makes ``json.dumps`` raise ``ValueError("Circular
    reference detected")`` — NOT ``RecursionError``. CPython's ``json``
    encoder detects the cycle via its ``markers`` dict and raises
    ``ValueError`` long before the recursion limit is hit.
    ``GenerateA2UITool.handle`` must catch it and emit a structured-error
    JSON string rather than propagate the exception to langroid's
    tool-handling stack. Pins the ``ValueError`` branch of the source's
    widened ``except (TypeError, ValueError, OverflowError,
    RecursionError)`` tuple.
    """
    cyclic: dict = {}
    cyclic["self"] = cyclic
    with patch(
        "agents.agent.generate_a2ui_via_llm",
        return_value={"a2ui_operations": [cyclic]},
    ):
        tool = GenerateA2UITool(context="")
        out = tool.handle()
    assert isinstance(out, str)
    parsed = json.loads(out)
    _assert_full_error_shape(parsed)
    assert parsed["error"] == "a2ui_invalid_arguments"


def test_tool_handle_wraps_recursion_error_on_deep_nesting():
    """The ``RecursionError`` branch of the source's widened ``json.dumps``
    catch must actually be exercised. Patches the module-local
    ``_json_dumps`` binding (NOT the stdlib ``json.dumps``) to raise
    ``RecursionError`` — ``json.dumps`` on truly pathological inputs
    (e.g. deeply-nested but acyclic structures) can hit ``RecursionError``
    under sufficient nesting, and we also want the source to stay
    resilient against any future regression that introduces it via a
    different path.

    NOTE on patching discipline: earlier test revisions patched
    ``agents.agent.json.dumps`` directly, which mutates the shared stdlib
    module object and can collide with pytest / caplog internals that
    dispatch through ``json.dumps`` while the patch is active. The source
    introduces a module-local ``_json_dumps = json.dumps`` binding so
    tests can patch ONLY the agent's success-path serialization without
    leaking into unrelated stdlib consumers. The exception-branch
    structured-error dump uses the raw ``json.dumps`` so the error
    envelope still serializes even when ``_json_dumps`` is patched.
    """
    with patch(
        "agents.agent.generate_a2ui_via_llm",
        return_value={"a2ui_operations": [{"deep": "stub"}]},
    ), patch(
        "agents.agent._json_dumps", side_effect=RecursionError("max depth")
    ):
        tool = GenerateA2UITool(context="")
        out = tool.handle()
    assert isinstance(out, str)
    parsed = json.loads(out)
    _assert_full_error_shape(parsed)
    assert parsed["error"] == "a2ui_invalid_arguments"
    # Message must mention the class name so operators can diagnose the
    # branch that fired.
    assert "RecursionError" in parsed["message"]


# ---------------------------------------------------------------------------
# Additional _A2uiSuccess boundary validation — parametrized coverage for
# non-dict / None / wrong-shape returns from build_a2ui_operations_from_tool_call.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "builder_return,case",
    [
        (None, "returns None"),
        (["not", "a", "dict"], "returns list"),
        ({"a2ui_operations": None}, "operations key None"),
        ({"a2ui_operations": "not a list"}, "operations key str"),
    ],
)
def test_build_a2ui_boundary_rejects_malformed_shapes(builder_return, case):
    """The planner's boundary-validation layer must reject every shape that
    doesn't match ``_A2uiSuccess`` contract (``{"a2ui_operations": [...]}``
    with a list value). Parametrized so all four failure modes are exercised
    — a regression that loosens the ``isinstance(..., list)`` check to
    ``is not None`` would be caught by the 'operations key str' case.
    """
    fake_llm = MagicMock()
    args = {
        "surfaceId": "s",
        "catalogId": "copilotkit://app-dashboard-catalog",
        "components": [{"id": "root", "type": "Container"}],
    }
    fake_llm.chat.return_value = _llm_response(
        tool_calls=[_oai_tool_call(arguments=args)]
    )
    with patch("agents.agent._get_a2ui_llm", return_value=fake_llm), patch(
        "agents.agent.build_a2ui_operations_from_tool_call",
        return_value=builder_return,
    ):
        result = generate_a2ui_via_llm(context="")
    _assert_full_error_shape(result)
    assert result["error"] == "a2ui_invalid_arguments", f"case: {case}"


# ---------------------------------------------------------------------------
# create_agent factory — wiring contract with langroid
# ---------------------------------------------------------------------------


def test_create_agent_wires_all_tools_with_stream_true(monkeypatch):
    """``create_agent`` must:
      - construct ``OpenAIGPTConfig`` with ``chat_model=$LANGROID_MODEL`` and
        ``stream=True`` (primary agent streams to SSE; distinct from the
        planner's ``stream=False``).
      - construct ``ChatAgent`` and call ``enable_message(list(ALL_TOOLS))``
        with every tool.

    Pins the full wiring contract so a regression that drops a tool from
    ``ALL_TOOLS`` or flips the primary agent to ``stream=False`` is caught.

    Captures via ``lm.OpenAIGPTConfig`` (not ``lm.OpenAIGPT``) because
    langroid's ``ChatAgent`` lazily constructs the LLM from the config —
    ``create_agent`` itself only instantiates the config, not the LLM.
    """
    monkeypatch.setenv("LANGROID_MODEL", "anthropic/claude-opus-4")

    captured_config_kwargs: list[dict] = []
    enable_message_calls: list[Any] = []

    # Import the real config / agent types so isinstance checks (and
    # attribute access) still work downstream; we only intercept
    # construction kwargs for assertion.
    import agents.agent as agent_mod
    real_config_cls = agent_mod.lm.OpenAIGPTConfig

    def _spy_config(**kwargs):
        captured_config_kwargs.append(kwargs)
        # Return a real instance so subsequent code paths (including any
        # model-string validation inside langroid) keep working.
        return real_config_cls(**kwargs)

    class _FakeAgent:
        def __init__(self, config):
            self.config = config

        def enable_message(self, tools):
            enable_message_calls.append(tools)

    with patch("agents.agent.lm.OpenAIGPTConfig", side_effect=_spy_config), patch(
        "agents.agent.lr.ChatAgent", _FakeAgent
    ):
        agent = create_agent()

    # Config kwargs: model from env, stream=True.
    assert len(captured_config_kwargs) == 1
    kwargs = captured_config_kwargs[0]
    assert kwargs["chat_model"] == "anthropic/claude-opus-4"
    assert kwargs["stream"] is True, (
        f"create_agent must construct primary LLM config with stream=True; "
        f"got stream={kwargs.get('stream')!r}"
    )

    # enable_message called once with a list equal to list(ALL_TOOLS).
    assert len(enable_message_calls) == 1
    enabled = enable_message_calls[0]
    assert enabled == list(ALL_TOOLS), (
        f"enable_message must receive list(ALL_TOOLS); got {enabled!r}"
    )

    # Returned value is the fake agent instance.
    assert isinstance(agent, _FakeAgent)


def test_create_agent_default_model_when_langroid_model_unset(monkeypatch):
    """When ``LANGROID_MODEL`` is unset, ``create_agent`` falls back to the
    documented default ``gpt-4.1``. Pins the default string in a
    second test site (the other is ``_resolve_a2ui_model``) so a silent
    drift between the two defaults is caught."""
    monkeypatch.delenv("LANGROID_MODEL", raising=False)

    captured_config_kwargs: list[dict] = []

    import agents.agent as agent_mod
    real_config_cls = agent_mod.lm.OpenAIGPTConfig

    def _spy_config(**kwargs):
        captured_config_kwargs.append(kwargs)
        return real_config_cls(**kwargs)

    class _FakeAgent:
        def __init__(self, config):
            pass

        def enable_message(self, tools):
            pass

    with patch("agents.agent.lm.OpenAIGPTConfig", side_effect=_spy_config), patch(
        "agents.agent.lr.ChatAgent", _FakeAgent
    ):
        create_agent()

    assert captured_config_kwargs[0]["chat_model"] == "gpt-4.1"


# ---------------------------------------------------------------------------
# Complementary module-hygiene regression: subprocess-import warnings check.
# The AST walker only catches static imports. This test catches dynamic
# imports (e.g. a function-scope ``import openai`` that fires on module load
# via side-effect) AND provider-SDK-emitted warnings that would leak to
# stderr at import time.
# ---------------------------------------------------------------------------


def test_agent_module_import_does_not_warn_about_openai_on_stderr(tmp_path):
    """Complement to the AST walker: run ``import agents.agent`` in a clean
    subprocess and assert neither stdout nor stderr mentions ``openai``.
    Catches:
      - dynamic imports (function-scope ``import openai`` triggered at
        module load via side-effect) that the AST walker misses.
      - provider-SDK-emitted deprecation / initialization warnings that
        leak the provider name to stderr.

    A regression that reintroduces a lazy ``import openai`` inside a
    module-level ``try``-block whose body runs at import time would be
    caught here even if the AST walker's scoping missed it.
    """
    env = {
        k: v for k, v in os.environ.items()
        if not k.startswith(("OPENAI_", "LANGROID_", "A2UI_"))
    }
    # Include the integration root (for the ``tools`` symlink) and src/
    # (for ``agents.*``).  Mirrors CI's ``PYTHONPATH=".:src:..."``.
    pkg_root = Path(__file__).resolve().parents[2]
    src_dir = pkg_root / "src"
    existing_pp = env.get("PYTHONPATH", "")
    new_pp = f"{pkg_root}{os.pathsep}{src_dir}"
    env["PYTHONPATH"] = (
        f"{new_pp}{os.pathsep}{existing_pp}" if existing_pp else new_pp
    )

    result = subprocess.run(
        [sys.executable, "-c", "import agents.agent"],
        env=env,
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"import agents.agent failed: stdout={result.stdout!r} "
        f"stderr={result.stderr!r}"
    )
    # Tight regex: an unconditional ``"openai" not in ...`` check is
    # fragile — langroid's own ``OpenAIGPTConfig`` (imported at module
    # load) emits benign messages that can contain "OpenAIGPT" / "openai"
    # without actually importing the ``openai`` SDK. We look specifically
    # for the regressions that matter: an actual ``import openai`` (or
    # ``from openai import``) succeeding or warning, OR a direct SDK
    # instantiation (``openai.OpenAI(`` / ``openai.Client(``).
    import re

    regression_patterns = [
        r"\bimport openai\b",
        r"\bfrom openai\b",
        r"\bopenai\.OpenAI\s*\(",
        r"\bopenai\.Client\s*\(",
    ]
    for stream_name, stream_val in (
        ("stderr", result.stderr),
        ("stdout", result.stdout),
    ):
        for pat in regression_patterns:
            assert not re.search(pat, stream_val), (
                f"{stream_name} matched regression pattern {pat!r}: "
                f"{stream_val!r}"
            )
