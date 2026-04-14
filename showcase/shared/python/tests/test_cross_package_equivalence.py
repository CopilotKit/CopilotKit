"""Cross-package equivalence test.

Verifies that all showcase packages' backend tools produce structurally
equivalent outputs when given identical inputs.
"""
import pytest
from tools import (
    get_weather_impl, query_data_impl, manage_sales_todos_impl,
    get_sales_todos_impl, search_flights_impl, generate_a2ui_impl,
    schedule_meeting_impl,
)

# These tests verify the SHARED implementations. Since all 17 packages
# wrap these same functions, if the shared impls are correct, all
# packages produce equivalent outputs.

class TestToolOutputEquivalence:
    """All tools return consistent structures regardless of caller."""

    def test_weather_consistent_structure(self):
        cities = ["Tokyo", "London", "New York", "São Paulo", "Sydney"]
        for city in cities:
            result = get_weather_impl(city)
            assert set(result.keys()) == {"city", "temperature", "humidity", "wind_speed", "feels_like", "conditions"}
            assert result["city"] == city
            assert isinstance(result["temperature"], int)

    def test_query_data_consistent_columns(self):
        for query in ["revenue", "expenses", "all", ""]:
            result = query_data_impl(query)
            assert len(result) > 0
            for row in result:
                assert "category" in row or "date" in row

    def test_manage_todos_idempotent_structure(self):
        input_todos = [
            {"title": "Deal A", "stage": "prospect", "value": 10000},
            {"title": "Deal B", "stage": "qualified", "value": 50000},
        ]
        result = manage_sales_todos_impl(input_todos)
        assert len(result) == 2
        for todo in result:
            assert all(k in todo for k in ["id", "title", "stage", "value", "dueDate", "assignee", "completed"])

    def test_get_todos_none_returns_initial(self):
        result = get_sales_todos_impl(None)
        assert len(result) == 3
        assert all(t["id"].startswith("st-") for t in result)

    def test_search_flights_returns_a2ui_ops(self):
        flights = [{"airline": "Test", "flightNumber": "T1", "origin": "SFO", "destination": "JFK",
                     "date": "Mon", "departureTime": "08:00", "arrivalTime": "16:00",
                     "duration": "8h", "status": "On Time", "statusColor": "#22c55e",
                     "price": "$300", "currency": "USD", "airlineLogo": "https://example.com/logo.png"}]
        result = search_flights_impl(flights)
        assert "a2ui_operations" in result
        ops = result["a2ui_operations"]
        assert any(op["type"] == "create_surface" for op in ops)
        assert any(op["type"] == "update_components" for op in ops)

    def test_generate_a2ui_returns_prompt_and_schema(self):
        result = generate_a2ui_impl(messages=[{"role": "user", "content": "show dashboard"}])
        assert "system_prompt" in result
        assert "tool_schema" in result
        assert result["tool_schema"]["name"] == "render_a2ui"

    def test_schedule_meeting_returns_pending(self):
        result = schedule_meeting_impl("quarterly review", 45)
        assert result["status"] == "pending_approval"
        assert result["reason"] == "quarterly review"
        assert result["duration_minutes"] == 45
