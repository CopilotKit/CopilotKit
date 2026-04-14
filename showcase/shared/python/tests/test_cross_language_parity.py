"""Cross-language parity tests.

Verify that Python shared tool outputs match the structural contracts
that TypeScript equivalents also follow. If these tests pass in Python
AND the TS tests pass, the implementations are structurally compatible.
"""
from tools import (
    get_weather_impl, query_data_impl, manage_sales_todos_impl,
    get_sales_todos_impl, search_flights_impl, schedule_meeting_impl,
    INITIAL_TODOS,
)

def test_weather_field_names_match_typescript():
    """WeatherResult fields must be: city, temperature, humidity, wind_speed, feels_like, conditions"""
    result = get_weather_impl("Tokyo")
    expected_fields = {"city", "temperature", "humidity", "wind_speed", "feels_like", "conditions"}
    assert set(result.keys()) == expected_fields

def test_initial_todos_ids_match_typescript():
    """INITIAL_TODOS IDs must be st-001, st-002, st-003 (same as TS)"""
    assert [t["id"] for t in INITIAL_TODOS] == ["st-001", "st-002", "st-003"]

def test_initial_todos_count_matches_typescript():
    assert len(INITIAL_TODOS) == 3

def test_manage_todos_provides_same_defaults_as_typescript():
    """Missing fields default to: stage=prospect, value=0, completed=False"""
    result = manage_sales_todos_impl([{"title": "Test"}])
    assert result[0]["stage"] == "prospect"
    assert result[0]["value"] == 0
    assert result[0]["completed"] == False
    assert result[0]["dueDate"] == ""
    assert result[0]["assignee"] == ""

def test_get_todos_none_returns_initial():
    result = get_sales_todos_impl(None)
    assert len(result) == 3

def test_get_todos_empty_returns_empty():
    result = get_sales_todos_impl([])
    assert result == []

def test_search_flights_returns_a2ui_operations():
    result = search_flights_impl([{"airline": "Test"}])
    assert "a2ui_operations" in result

def test_schedule_meeting_returns_pending():
    result = schedule_meeting_impl("test")
    assert result["status"] == "pending_approval"

def test_query_data_returns_list_of_dicts_with_expected_columns():
    result = query_data_impl("test")
    assert isinstance(result, list)
    assert len(result) > 0
    row = result[0]
    assert "category" in row and "date" in row  # Both columns must be present
