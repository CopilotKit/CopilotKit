"""Sales todos are durable native agent state, not only a UI snapshot.

``manage_sales_todos`` owns the sales pipeline. It writes the processed list to
the Strands agent's own ``agent.state`` under ``"todos"`` through the tool
context, so a configured SessionManager persists and restores it with the rest
of the session. ``sales_state_from_args`` still sends the same list to the UI as
a STATE_SNAPSHOT; the two must agree, including the ids assigned to new items.
"""

from __future__ import annotations

import asyncio
import copy
from types import SimpleNamespace
from typing import Any

import pytest


class _AgentState:
    """Mirrors the Strands ``AgentState`` contract the tool relies on."""

    def __init__(self, initial: dict[str, Any] | None = None) -> None:
        self._data: dict[str, Any] = copy.deepcopy(initial or {})

    def set(self, key: str, value: Any) -> None:
        self._data[key] = copy.deepcopy(value)

    def get(self, key: str | None = None) -> Any:
        if key is None:
            return copy.deepcopy(self._data)
        return copy.deepcopy(self._data.get(key))


def _tool_context(state: _AgentState, tool_use_id: str = "call-1") -> SimpleNamespace:
    return SimpleNamespace(
        agent=SimpleNamespace(state=state),
        tool_use={"toolUseId": tool_use_id, "name": "manage_sales_todos", "input": {}},
    )


def _todo(title: str, **fields: Any) -> dict[str, Any]:
    return {"title": title, "stage": "prospect", "value": 1000, **fields}


@pytest.fixture
def agent_mod():
    import agents.agent as module

    return module


def test_writes_processed_todos_to_native_agent_state(agent_mod):
    state = _AgentState()
    todos = [
        _todo("Call Acme", id="t1"),
        _todo("Email Globex", id="t2", completed=True),
    ]

    agent_mod.manage_sales_todos(todos=todos, tool_context=_tool_context(state))

    assert state.get("todos") == [dict(t) for t in agent_mod.manage_todos_impl(todos)]


def test_return_message_is_unchanged(agent_mod):
    result = agent_mod.manage_sales_todos(
        todos=[_todo("Call Acme", id="t1")], tool_context=_tool_context(_AgentState())
    )

    assert result == "Sales todos updated. Tracking 1 item(s)."


def test_latest_call_replaces_the_stored_list(agent_mod):
    state = _AgentState()
    agent_mod.manage_sales_todos(
        todos=[_todo("Call Acme", id="t1"), _todo("Email Globex", id="t2")],
        tool_context=_tool_context(state, "call-1"),
    )

    agent_mod.manage_sales_todos(
        todos=[_todo("Call Acme", id="t1", completed=True)],
        tool_context=_tool_context(state, "call-2"),
    )

    stored = state.get("todos")
    assert [(t["id"], t["status"]) for t in stored] == [("t1", "completed")]


def test_leaves_other_state_keys_alone(agent_mod):
    state = _AgentState({"agui_context": [{"description": "d", "value": "v"}]})

    agent_mod.manage_sales_todos(
        todos=[_todo("Call Acme", id="t1")], tool_context=_tool_context(state)
    )

    assert state.get("agui_context") == [{"description": "d", "value": "v"}]


def test_new_items_get_the_same_ids_in_native_state_and_ui_snapshot(agent_mod):
    todos = [_todo("Call Acme"), _todo("Email Globex", id="kept")]
    state = _AgentState()

    agent_mod.manage_sales_todos(
        todos=copy.deepcopy(todos), tool_context=_tool_context(state, "call-7")
    )
    snapshot = asyncio.run(
        agent_mod.sales_state_from_args(
            SimpleNamespace(
                tool_input={"todos": copy.deepcopy(todos)}, tool_use_id="call-7"
            )
        )
    )

    stored = state.get("todos")
    assert snapshot == {"todos": stored}
    assert stored[1]["id"] == "kept"
    assert stored[0]["id"] and stored[0]["id"] != stored[1]["id"]


def test_new_item_ids_differ_between_tool_calls(agent_mod):
    first, second = _AgentState(), _AgentState()

    agent_mod.manage_sales_todos(
        todos=[_todo("Call Acme")], tool_context=_tool_context(first, "call-1")
    )
    agent_mod.manage_sales_todos(
        todos=[_todo("Call Acme")], tool_context=_tool_context(second, "call-2")
    )

    assert first.get("todos")[0]["id"] != second.get("todos")[0]["id"]


def test_board_contract_and_authoritative_read(agent_mod):
    state = _AgentState()
    todos = [{"title": "Cedar", "description": "Follow up Cedar", "status": "pending"}]
    agent_mod.manage_sales_todos(todos=todos, tool_context=_tool_context(state))
    saved = state.get("todos")
    assert saved[0]["description"] == "Follow up Cedar"
    assert saved[0]["status"] == "pending"
    assert "completed" not in saved[0]
    assert agent_mod.get_sales_todos(tool_context=_tool_context(state)) == saved
    assert agent_mod.get_sales_todos(tool_context=_tool_context(_AgentState())) == []
