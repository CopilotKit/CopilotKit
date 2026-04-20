"""Tests for ``sales_state_from_args`` in src/agents/agent.py.

``sales_state_from_args`` runs as a tool-result callback for
``manage_sales_todos`` and emits a ``{"todos": [...]}`` snapshot for the
UI. The function uses shape-directed dispatch (``isinstance`` checks on
``tool_input``), not try/except-AttributeError, to support three
realistic input shapes:

  * ``tool_input`` as a ``dict`` with a ``"todos"`` key (the usual path
    when the LLM calls the tool through the strands machinery),
  * ``tool_input`` as a JSON ``str`` (parsed via ``json.loads``; the only
    exception-guarded branch, catching ``json.JSONDecodeError``),
  * ``tool_input`` as the bare list (the LLM occasionally inlines the
    list without the ``"todos"`` wrapper — the ``isinstance(_, list)``
    branch treats it as the todos payload directly).

Unsupported types (int, None, missing attribute) short-circuit with a
warning log and a ``None`` return — silently dropping the state snapshot
is preferable to blowing up the tool response pipeline over malformed
input.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest


def _run(coro):
    """Run an async coroutine synchronously for tests.

    ``sales_state_from_args`` is ``async def`` (strands invokes it as a
    tool-result callback in an event loop). Using ``asyncio.run`` keeps
    each test self-contained and avoids event-loop leakage between tests.
    """
    return asyncio.run(coro)


@pytest.fixture
def _patched_impl(monkeypatch):
    """Patch ``manage_sales_todos_impl`` with a deterministic pass-through
    so the test doesn't depend on the shared tool's real filtering logic.

    The real impl is covered by tests in the shared-python tools package.
    """
    import agents.agent as agent_mod

    def _identity(todos):
        # Return a list of dicts (the real impl returns the same shape).
        return [dict(t) for t in todos]

    monkeypatch.setattr(agent_mod, "manage_sales_todos_impl", _identity)
    return agent_mod


def test_dict_tool_input_with_todos_key(_patched_impl):
    """Happy path: ``tool_input`` is a dict with ``"todos"`` → returns
    ``{"todos": [...]}``."""
    from agents.agent import sales_state_from_args

    todos = [{"id": "t1", "title": "Call Acme"}, {"id": "t2", "title": "Follow up"}]
    ctx = SimpleNamespace(tool_input={"todos": todos})

    result = _run(sales_state_from_args(ctx))

    assert result == {"todos": todos}


def test_json_string_tool_input(_patched_impl):
    """``tool_input`` as a JSON string is parsed and processed identically."""
    from agents.agent import sales_state_from_args

    todos = [{"id": "s1", "title": "Prospect"}]
    ctx = SimpleNamespace(tool_input=json.dumps({"todos": todos}))

    result = _run(sales_state_from_args(ctx))

    assert result == {"todos": todos}


def test_bare_list_tool_input(_patched_impl):
    """When the LLM inlines the list directly (no ``"todos"`` wrapper),
    the function emits the state snapshot. The shape-directed dispatch
    uses ``isinstance(tool_input, list)`` to treat the bare list as the
    todos payload — no ``.get``, no exception handling for this branch.
    """
    from agents.agent import sales_state_from_args

    todos = [{"id": "b1", "title": "Bare list"}]
    ctx = SimpleNamespace(tool_input=todos)

    result = _run(sales_state_from_args(ctx))

    # isinstance(tool_input, list) path: bare list IS the todos payload.
    assert result == {"todos": todos}


def test_malformed_json_string_returns_none(_patched_impl):
    """Invalid JSON in ``tool_input`` must NOT propagate — returns None."""
    from agents.agent import sales_state_from_args

    ctx = SimpleNamespace(tool_input="{not valid json")

    result = _run(sales_state_from_args(ctx))

    assert result is None


def test_missing_tool_input_attribute_returns_none(_patched_impl):
    """If the context lacks ``tool_input`` entirely, we fall back to None.

    The function uses ``getattr(context, "tool_input", None)`` for the
    initial fetch and short-circuits on ``None`` via an explicit check —
    no exception is raised or caught for this branch.
    """
    from agents.agent import sales_state_from_args

    # An object without ``tool_input`` at all. getattr returns None, which
    # the function handles via an explicit None check (no AttributeError).
    class _Ctx:
        pass

    result = _run(sales_state_from_args(_Ctx()))

    assert result is None


def test_non_dict_non_string_tool_input_returns_none(_patched_impl):
    """Edge case: ``tool_input`` is an int (LLM misfire). Must not crash."""
    from agents.agent import sales_state_from_args

    ctx = SimpleNamespace(tool_input=42)

    result = _run(sales_state_from_args(ctx))

    # Shape-directed dispatch: int is neither dict, list, nor str; the
    # unsupported-type branch logs a warning and returns None.
    assert result is None


def test_empty_todos_list_returns_empty_snapshot(_patched_impl):
    """Empty todos list is valid input and produces ``{"todos": []}``."""
    from agents.agent import sales_state_from_args

    ctx = SimpleNamespace(tool_input={"todos": []})

    result = _run(sales_state_from_args(ctx))

    assert result == {"todos": []}


def test_processed_todos_pass_through_shared_impl(monkeypatch):
    """Confirms the function actually routes through
    ``manage_sales_todos_impl`` (not just returning the raw input)."""
    import agents.agent as agent_mod
    from agents.agent import sales_state_from_args

    def _transformer(todos):
        # Simulate the real impl adding an index or filtering.
        return [{"id": t.get("id"), "normalized": True} for t in todos]

    monkeypatch.setattr(agent_mod, "manage_sales_todos_impl", _transformer)

    ctx = SimpleNamespace(tool_input={"todos": [{"id": "x"}, {"id": "y"}]})

    result = _run(sales_state_from_args(ctx))

    assert result == {"todos": [
        {"id": "x", "normalized": True},
        {"id": "y", "normalized": True},
    ]}


def test_logger_warning_on_malformed_input(_patched_impl, caplog):
    """Malformed input should emit a WARNING log with a truncated
    excerpt so on-call can debug without a full traceback."""
    import logging

    from agents.agent import sales_state_from_args

    ctx = SimpleNamespace(tool_input="{not json")

    with caplog.at_level(logging.WARNING, logger="agents.agent"):
        result = _run(sales_state_from_args(ctx))

    assert result is None
    # At least one warning record must mention the parse failure.
    warning_records = [r for r in caplog.records if r.levelname == "WARNING"]
    assert warning_records, "expected a WARNING log on malformed tool input"
    combined = " ".join(r.getMessage() for r in warning_records)
    assert "sales_state_from_args" in combined
