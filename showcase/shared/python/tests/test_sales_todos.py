import pytest
from tools import manage_sales_todos_impl, get_sales_todos_impl, INITIAL_TODOS

def test_initial_todos_have_fixed_ids():
    assert INITIAL_TODOS[0]["id"] == "st-001"
    assert INITIAL_TODOS[1]["id"] == "st-002"
    assert INITIAL_TODOS[2]["id"] == "st-003"

def test_initial_todos_count():
    assert len(INITIAL_TODOS) == 3

def test_manage_assigns_id_to_missing():
    result = manage_sales_todos_impl([{"title": "New deal"}])
    assert result[0]["id"]  # should have an ID assigned
    assert len(result[0]["id"]) > 0

def test_manage_preserves_existing_id():
    result = manage_sales_todos_impl([{"id": "keep-me", "title": "Deal"}])
    assert result[0]["id"] == "keep-me"

def test_manage_provides_defaults():
    result = manage_sales_todos_impl([{"title": "Minimal"}])
    assert result[0]["stage"] == "prospect"
    assert result[0]["value"] == 0
    assert result[0]["dueDate"] == ""
    assert result[0]["assignee"] == ""
    assert result[0]["completed"] == False

def test_get_returns_initial_when_none():
    result = get_sales_todos_impl(None)
    assert len(result) == 3
    assert result[0]["id"] == "st-001"

def test_get_returns_empty_when_empty_list():
    result = get_sales_todos_impl([])
    assert result == []

def test_get_returns_provided_todos():
    todos = [{"id": "1", "title": "Test", "stage": "prospect", "value": 100, "dueDate": "", "assignee": "", "completed": False}]
    result = get_sales_todos_impl(todos)
    assert len(result) == 1
    assert result[0]["title"] == "Test"
