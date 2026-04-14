import pytest
from tools import search_flights_impl
from tools.search_flights import SURFACE_ID, CATALOG_ID

_FULL_FLIGHT = {
    "airline": "Test Air", "flightNumber": "TA100", "origin": "SFO", "destination": "JFK",
    "date": "Tue, Apr 15", "departureTime": "08:00", "arrivalTime": "16:00",
    "duration": "5h", "status": "On Time", "statusColor": "#22c55e",
    "price": "$299", "currency": "USD", "airlineLogo": "https://example.com/logo.png",
}

def test_returns_a2ui_operations():
    result = search_flights_impl([_FULL_FLIGHT])
    assert "a2ui_operations" in result

def test_operations_structure():
    flights = [{"airline": "Test"}]
    result = search_flights_impl(flights)
    ops = result["a2ui_operations"]
    assert any(op["type"] == "create_surface" for op in ops)
    assert any(op["type"] == "update_components" for op in ops)

def test_all_three_operation_types_present():
    result = search_flights_impl([_FULL_FLIGHT])
    ops = result["a2ui_operations"]
    types = [op["type"] for op in ops]
    assert "create_surface" in types
    assert "update_components" in types
    assert "update_data_model" in types

def test_surface_and_catalog_ids():
    result = search_flights_impl([_FULL_FLIGHT])
    ops = result["a2ui_operations"]
    create_op = next(op for op in ops if op["type"] == "create_surface")
    assert create_op["surfaceId"] == SURFACE_ID
    assert create_op["catalogId"] == CATALOG_ID

def test_flight_data_embedded_in_data_model():
    flights = [_FULL_FLIGHT, {"airline": "Second Air"}]
    result = search_flights_impl(flights)
    ops = result["a2ui_operations"]
    data_op = next(op for op in ops if op["type"] == "update_data_model")
    assert data_op["data"]["flights"] == flights

def test_empty_flights_list():
    result = search_flights_impl([])
    ops = result["a2ui_operations"]
    assert len(ops) == 3
    data_op = next(op for op in ops if op["type"] == "update_data_model")
    assert data_op["data"]["flights"] == []

def test_properly_formed_flight_objects():
    result = search_flights_impl([_FULL_FLIGHT])
    ops = result["a2ui_operations"]
    data_op = next(op for op in ops if op["type"] == "update_data_model")
    flight = data_op["data"]["flights"][0]
    for key in ("airline", "flightNumber", "origin", "destination", "date",
                "departureTime", "arrivalTime", "duration", "status", "price"):
        assert key in flight
