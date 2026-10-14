import pytest
from tools import search_flights_impl
from tools.search_flights import SURFACE_ID, CATALOG_ID

_FULL_FLIGHT = {
    "airline": "Test Air",
    "flightNumber": "TA100",
    "origin": "SFO",
    "destination": "JFK",
    "date": "Tue, Apr 15",
    "departureTime": "08:00",
    "arrivalTime": "16:00",
    "duration": "5h",
    "status": "On Time",
    "statusColor": "#22c55e",
    "price": "$299",
    "currency": "USD",
    "airlineLogo": "https://example.com/logo.png",
}


def _payload(ops, key):
    """Return the payload of the v0.9 operation carrying `key`."""
    return next(op[key] for op in ops if key in op)


def test_returns_a2ui_operations():
    result = search_flights_impl([_FULL_FLIGHT])
    assert "a2ui_operations" in result


def test_operations_use_v09_nested_shape():
    result = search_flights_impl([{"airline": "Test"}])
    ops = result["a2ui_operations"]
    assert all(op["version"] == "v0.9" for op in ops)
    assert [key for op in ops for key in op if key != "version"] == [
        "createSurface",
        "updateComponents",
        "updateDataModel",
    ]


def test_surface_and_catalog_ids():
    result = search_flights_impl([_FULL_FLIGHT])
    ops = result["a2ui_operations"]
    create = _payload(ops, "createSurface")
    assert create["surfaceId"] == SURFACE_ID
    assert create["catalogId"] == CATALOG_ID
    assert _payload(ops, "updateComponents")["surfaceId"] == SURFACE_ID
    assert _payload(ops, "updateDataModel")["surfaceId"] == SURFACE_ID


def test_flight_data_embedded_in_data_model():
    flights = [_FULL_FLIGHT, {"airline": "Second Air"}]
    result = search_flights_impl(flights)
    data = _payload(result["a2ui_operations"], "updateDataModel")
    assert data["path"] == "/"
    assert data["value"]["flights"] == flights


def test_empty_flights_list():
    result = search_flights_impl([])
    ops = result["a2ui_operations"]
    assert len(ops) == 3
    assert _payload(ops, "updateDataModel")["value"]["flights"] == []


def test_properly_formed_flight_objects():
    result = search_flights_impl([_FULL_FLIGHT])
    data = _payload(result["a2ui_operations"], "updateDataModel")
    flight = data["value"]["flights"][0]
    for key in (
        "airline",
        "flightNumber",
        "origin",
        "destination",
        "date",
        "departureTime",
        "arrivalTime",
        "duration",
        "status",
        "price",
    ):
        assert key in flight
