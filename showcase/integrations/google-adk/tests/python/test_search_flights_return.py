"""Tests for search_flights human-readable return values.

search_flights must return both a "result" key with human-readable data
(so Gemini sees structured success information and stops re-calling) AND
the existing "a2ui_operations" key for middleware rendering.
"""

from __future__ import annotations

from agents.main import search_flights


class FakeToolContext:
    """Minimal tool_context replica with .state."""

    def __init__(self) -> None:
        self.state = {}


def _make_flights() -> list[dict]:
    """Return 2 sample flight dicts with all required fields."""
    return [
        {
            "airline": "Delta",
            "airlineLogo": "https://www.google.com/s2/favicons?domain=delta.com&sz=128",
            "flightNumber": "DL1234",
            "origin": "SFO",
            "destination": "JFK",
            "date": "Tue, Mar 18",
            "departureTime": "08:00 AM",
            "arrivalTime": "04:25 PM",
            "duration": "5h 25m",
            "status": "On Time",
            "statusColor": "#22c55e",
            "price": "$289",
            "currency": "USD",
        },
        {
            "airline": "United",
            "airlineLogo": "https://www.google.com/s2/favicons?domain=united.com&sz=128",
            "flightNumber": "UA5678",
            "origin": "SFO",
            "destination": "JFK",
            "date": "Tue, Mar 18",
            "departureTime": "10:30 AM",
            "arrivalTime": "06:55 PM",
            "duration": "5h 25m",
            "status": "Delayed",
            "statusColor": "#ef4444",
            "price": "$349",
            "currency": "USD",
        },
    ]


def test_search_flights_returns_human_readable_result():
    """The return dict must have a 'result' key that is a string mentioning
    the flight count."""
    ctx = FakeToolContext()
    flights = _make_flights()
    result = search_flights(ctx, flights)
    assert "result" in result, f"missing 'result' key in: {result.keys()}"
    assert isinstance(result["result"], str), f"'result' is not a str: {type(result['result'])}"
    assert "2" in result["result"], f"flight count not in result: {result['result']}"


def test_search_flights_still_contains_a2ui_operations():
    """The a2ui_operations key must still be present for middleware rendering."""
    ctx = FakeToolContext()
    flights = _make_flights()
    result = search_flights(ctx, flights)
    assert "a2ui_operations" in result, f"missing 'a2ui_operations' key in: {result.keys()}"
    assert isinstance(result["a2ui_operations"], list)
    assert len(result["a2ui_operations"]) > 0


def test_search_flights_result_mentions_airlines():
    """The human-readable summary should mention airline names."""
    ctx = FakeToolContext()
    flights = _make_flights()
    result = search_flights(ctx, flights)
    summary = result["result"]
    assert "Delta" in summary, f"airline 'Delta' not in summary: {summary}"
    assert "United" in summary, f"airline 'United' not in summary: {summary}"


def test_search_flights_result_mentions_prices():
    """The human-readable summary should contain price info."""
    ctx = FakeToolContext()
    flights = _make_flights()
    result = search_flights(ctx, flights)
    summary = result["result"]
    assert "$289" in summary, f"price '$289' not in summary: {summary}"
    assert "$349" in summary, f"price '$349' not in summary: {summary}"
