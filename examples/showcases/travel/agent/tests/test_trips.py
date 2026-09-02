import json
import unittest
from typing import TypedDict
from unittest.mock import AsyncMock, patch

from langchain_core.messages import AIMessage, ToolMessage

from src.state import AgentState, Place, Trip
from src.trips import perform_trips_node


class PlaceSelectionResponse(TypedDict):
    operation: str
    placeIds: list[str]


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


def trip(place_ids: list[str]) -> Trip:
    return {
        "id": "trip-1",
        "name": "Trip 1",
        "center_latitude": 0,
        "center_longitude": 0,
        "zoom": 10,
        "places": [place(place_id) for place_id in place_ids],
    }


def update_state(
    response: PlaceSelectionResponse, proposed_place_ids: list[str]
) -> AgentState:
    ai_message = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "update_trips",
                "args": {"trips": [trip(proposed_place_ids)]},
                "id": "update-call",
                "type": "tool_call",
            }
        ],
    )
    tool_message = ToolMessage(
        content=json.dumps(response),
        tool_call_id="update-call",
    )
    return AgentState(
        messages=[ai_message, tool_message],
        trips=[trip(["kept-place", "removed-place"])],
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


if __name__ == "__main__":
    unittest.main()
