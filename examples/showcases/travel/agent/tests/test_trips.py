import json
import unittest
from typing import NotRequired, TypedDict
from unittest.mock import AsyncMock, patch

from langchain_core.messages import AIMessage, ToolMessage

from src.state import AgentState, Place, Trip
from src.trips import perform_trips_node


class PlaceSelectionResponse(TypedDict):
    operation: str
    placeIds: list[str]


class TripPlaceSelection(TypedDict):
    tripId: str
    placeIds: NotRequired[list[str]]


class MultiTripSelectionResponse(TypedDict):
    operation: str
    selections: list[TripPlaceSelection]


def place(place_id: str) -> Place:
    return {
        "id": place_id,
        "name": place_id,
        "address": f"{place_id} address",
        "latitude": 0,
        "longitude": 0,
        "rating": 5,
        "description": None,
    }


def trip(trip_id: str, place_ids: list[str]) -> Trip:
    return {
        "id": trip_id,
        "name": trip_id,
        "center_latitude": 0,
        "center_longitude": 0,
        "zoom": 10,
        "places": [place(place_id) for place_id in place_ids],
    }


def update_state(
    response: PlaceSelectionResponse, proposed_place_ids: list[str]
) -> AgentState:
    return action_state(
        "update_trips",
        response,
        [trip("trip-1", proposed_place_ids)],
        [trip("trip-1", ["kept-place", "removed-place"])],
    )


def action_state(
    action: str,
    response: PlaceSelectionResponse | MultiTripSelectionResponse,
    proposed_trips: list[Trip],
    current_trips: list[Trip],
) -> AgentState:
    ai_message = AIMessage(
        content="",
        tool_calls=[
            {
                "name": action,
                "args": {"trips": proposed_trips},
                "id": "trips-call",
                "type": "tool_call",
            }
        ],
    )
    tool_message = ToolMessage(
        content=json.dumps(response),
        tool_call_id="trips-call",
    )
    return AgentState(
        messages=[ai_message, tool_message],
        trips=current_trips,
        selected_trip_id="trip-1",
        search_progress=[],
        planning_progress=[],
    )


class PerformTripsNodeTest(unittest.IsolatedAsyncioTestCase):
    async def test_edit_response_replaces_places_without_duplicates(self):
        state = update_state(
            {
                "operation": "replace",
                "placeIds": ["kept-place", "added-place"],
            },
            ["kept-place", "kept-place", "added-place"],
        )

        with patch("src.trips.copilotkit_emit_message", new_callable=AsyncMock):
            result = await perform_trips_node(state, {})

        self.assertEqual(
            [place["id"] for place in result["trips"][0]["places"]],
            ["kept-place", "added-place"],
        )

    async def test_edit_response_rejects_an_unknown_operation(self):
        state = update_state(
            {"operation": "append", "placeIds": ["added-place"]},
            ["added-place"],
        )

        with (
            patch("src.trips.copilotkit_emit_message", new_callable=AsyncMock),
            self.assertRaisesRegex(ValueError, "Unsupported place operation: append"),
        ):
            await perform_trips_node(state, {})

    async def test_multi_trip_edit_applies_each_replacement_selection(self):
        state = action_state(
            "update_trips",
            {
                "operation": "replace",
                "selections": [
                    {"tripId": "trip-a", "placeIds": ["a-added"]},
                    {
                        "tripId": "trip-b",
                        "placeIds": ["b-kept", "b-added"],
                    },
                ],
            },
            [
                trip("trip-a", ["a-kept", "a-added", "a-added"]),
                trip("trip-b", ["b-kept", "b-added"]),
            ],
            [
                trip("trip-a", ["a-kept", "a-removed"]),
                trip("trip-b", ["b-kept", "b-removed"]),
            ],
        )

        with patch("src.trips.copilotkit_emit_message", new_callable=AsyncMock):
            result = await perform_trips_node(state, {})

        self.assertEqual(
            {
                current_trip["id"]: [
                    current_place["id"] for current_place in current_trip["places"]
                ]
                for current_trip in result["trips"]
            },
            {
                "trip-a": ["a-added"],
                "trip-b": ["b-kept", "b-added"],
            },
        )

    async def test_multi_trip_add_applies_each_selection(self):
        state = action_state(
            "add_trips",
            {
                "operation": "select",
                "selections": [
                    {"tripId": "trip-a", "placeIds": ["a-two"]},
                    {"tripId": "trip-b", "placeIds": ["b-one"]},
                ],
            },
            [
                trip("trip-a", ["a-one", "a-two"]),
                trip("trip-b", ["b-one", "b-two"]),
            ],
            [],
        )

        with patch("src.trips.copilotkit_emit_message", new_callable=AsyncMock):
            result = await perform_trips_node(state, {})

        self.assertEqual(
            {
                added_trip["id"]: [
                    added_place["id"] for added_place in added_trip["places"]
                ]
                for added_trip in result["trips"]
            },
            {
                "trip-a": ["a-two"],
                "trip-b": ["b-one"],
            },
        )

    async def test_multi_trip_selection_distinguishes_default_empty_and_subset(self):
        state = action_state(
            "update_trips",
            {
                "operation": "replace",
                "selections": [
                    {"tripId": "trip-default"},
                    {"tripId": "trip-empty", "placeIds": []},
                    {"tripId": "trip-subset", "placeIds": ["subset-two"]},
                ],
            },
            [
                trip("trip-default", ["default-one", "default-one", "default-two"]),
                trip("trip-empty", ["empty-one"]),
                trip("trip-subset", ["subset-one", "subset-two"]),
            ],
            [
                trip("trip-default", ["default-stale"]),
                trip("trip-empty", ["empty-stale"]),
                trip("trip-subset", ["subset-stale"]),
            ],
        )

        with patch("src.trips.copilotkit_emit_message", new_callable=AsyncMock):
            result = await perform_trips_node(state, {})

        self.assertEqual(
            {
                updated_trip["id"]: [
                    updated_place["id"] for updated_place in updated_trip["places"]
                ]
                for updated_trip in result["trips"]
            },
            {
                "trip-default": ["default-one", "default-two"],
                "trip-empty": [],
                "trip-subset": ["subset-two"],
            },
        )


if __name__ == "__main__":
    unittest.main()
