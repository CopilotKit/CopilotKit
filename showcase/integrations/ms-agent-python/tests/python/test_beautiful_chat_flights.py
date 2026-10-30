"""Exercise the real tool boundary with provider-shaped flight arguments."""

import json
from copy import deepcopy
from pathlib import Path

import pytest

from agents.beautiful_chat import search_flights


@pytest.fixture
def flights():
    fixture = (
        Path(__file__).resolve().parents[4]
        / "aimock/d6/ms-agent-python/beautiful-chat.json"
    )
    entries = json.loads(fixture.read_text())["fixtures"]
    for entry in entries:
        for call in entry.get("response", {}).get("toolCalls", []):
            if call["name"] == "search_flights":
                return json.loads(call["arguments"])["flights"]
    raise AssertionError("Flight fixture not found")


async def cards(flights):
    result = await search_flights.invoke(arguments={"flights": flights})
    payload = json.loads(result[0].text)
    operations = payload["a2ui_operations"]
    assert operations[0]["createSurface"] == {
        "surfaceId": "flight-search-results",
        "catalogId": "copilotkit://app-dashboard-catalog",
    }
    components = operations[1]["updateComponents"]["components"]
    assert components[0]["children"] == [c["id"] for c in components[1:]]
    return components[1:]


@pytest.mark.asyncio
async def test_numeric_provider_prices_keep_currency(flights):
    flights[0].update(price=750, currency="USD")
    flights[1].update(price=680, currency="EUR")
    output = await cards(flights)
    assert [c["price"] for c in output] == ["USD 750", "EUR 680"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "price,currency,expected",
    [
        (680.5, "EUR", "EUR 680.5"),
        ("750", "USD", "USD 750"),
        ("680.50", "EUR", "EUR 680.50"),
        ("$349", "USD", "$349"),
        ("EUR 680.50", "EUR", "EUR 680.50"),
        (0, "JPY", "JPY 0"),
        (".50", "EUR", "EUR .50"),
        ("1e3", "EUR", "EUR 1e3"),
        ("1,200.00", "EUR", "EUR 1,200.00"),
    ],
)
async def test_display_price(price, currency, expected, flights):
    flights[0].update(price=price, currency=currency)
    assert (await cards(flights))[0]["price"] == expected


@pytest.mark.asyncio
async def test_preserves_fixture_fields_and_input(flights):
    original = deepcopy(flights)
    output = await cards(flights)
    for flight, card in zip(flights, output, strict=True):
        for field, value in flight.items():
            if field != "currency":  # currency is carried by the display price
                assert card[field] == value
    assert flights == original


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,value",
    [
        ("price", True),
        ("price", None),
        ("price", {"amount": 750}),
        ("price", float("nan")),
        ("price", float("inf")),
        ("airline", 123),
        ("duration", None),
        ("statusColor", 123),
        ("currency", 123),
    ],
)
async def test_invalid_fields_fail_at_tool_boundary(field, value, flights):
    flights[0][field] = value
    with pytest.raises(TypeError, match="Invalid arguments"):
        await search_flights.invoke(arguments={"flights": flights})


def test_tool_exposes_flight_fields():
    schema = search_flights.parameters()
    items = schema["properties"]["flights"]["items"]
    if "$ref" in items:
        items = schema["$defs"][items["$ref"].split("/")[-1]]
    assert set(items["properties"]) == {
        "airline",
        "airlineLogo",
        "flightNumber",
        "origin",
        "destination",
        "date",
        "departureTime",
        "arrivalTime",
        "duration",
        "status",
        "statusColor",
        "price",
        "currency",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("omit", [True, False])
async def test_optional_status_color_uses_renderer_default(omit, flights):
    if omit:
        del flights[0]["statusColor"]
    else:
        flights[0]["statusColor"] = None
    assert "statusColor" not in (await cards(flights))[0]


@pytest.mark.asyncio
async def test_missing_required_field_fails_at_tool_boundary(flights):
    del flights[0]["currency"]
    with pytest.raises(TypeError, match="Invalid arguments"):
        await search_flights.invoke(arguments={"flights": flights})
