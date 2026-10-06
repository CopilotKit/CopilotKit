"""The board contract must survive tool calls and persisted-state round trips."""

import json

import pytest

from tools.todos import manage_todos_impl
from tools.sales_todos import manage_sales_todos_impl


def test_legacy_sales_state_becomes_visible_without_losing_metadata():
    original = [
        {
            "id": "old",
            "title": "Follow up",
            "notes": "Call Friday",
            "completed": False,
            "stage": "proposal",
            "value": 85000,
        },
        {"id": "done", "title": "Sent quote", "completed": True},
    ]
    result = manage_todos_impl(original)
    assert [todo["status"] for todo in result] == ["pending", "completed"]
    assert result[0]["description"] == "Call Friday"
    assert result[0]["notes"] == "Call Friday"
    assert result[0]["stage"] == "proposal"
    assert result[0]["value"] == 85000
    assert all("completed" not in todo for todo in result)
    assert "status" not in original[0]  # ADK state is not mutated in place.


def test_board_create_complete_reopen_and_subsequent_turn_preserve_items():
    todos = manage_todos_impl(
        [
            {
                "title": "Send proposal",
                "description": "Include pricing",
                "emoji": "📨",
                "status": "pending",
            },
            {"id": "keep", "title": "Existing task", "notes": "Keep this note"},
        ]
    )
    task_id = todos[0]["id"]
    for status in ("completed", "pending"):
        # The real board spreads the object and changes only status.
        todos[0] = {**todos[0], "status": status}
        todos = manage_todos_impl(json.loads(json.dumps(todos)))
        assert todos[0] == {
            "id": task_id,
            "title": "Send proposal",
            "description": "Include pricing",
            "emoji": "📨",
            "status": status,
        }
        assert todos[1]["id"] == "keep"
        assert todos[1]["description"] == "Keep this note"
    todos = manage_todos_impl([*todos, {"title": "Next task"}])
    assert len(todos) == 3
    assert todos[0]["id"] == task_id


def test_board_edits_win_over_legacy_fields():
    result = manage_todos_impl(
        [
            {
                "status": "pending",
                "completed": True,
                "description": "",
                "notes": "Old note",
            }
        ]
    )
    assert result[0]["status"] == "pending"
    assert result[0]["description"] == ""
    assert "completed" not in result[0]


def test_empty_board_stays_empty():
    assert manage_todos_impl([]) == []


def test_invalid_status_fails_instead_of_hiding_task():
    with pytest.raises(ValueError, match="Unsupported todo status"):
        manage_todos_impl([{"status": "unknown"}])


def test_sales_pipeline_contract_is_unchanged():
    todos = manage_sales_todos_impl([{"title": "Deal", "completed": True}])
    assert todos[0]["completed"] is True
    assert "status" not in todos[0]
    todos[0]["completed"] = False
    assert manage_sales_todos_impl(todos)[0]["completed"] is False
