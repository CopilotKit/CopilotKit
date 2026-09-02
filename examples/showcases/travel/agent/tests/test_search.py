import json
import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from langchain_core.messages import AIMessage

TEST_API_KEY = "AIza" + ("a" * 35)

from src.search import search_node


class SearchNodeTest(unittest.IsolatedAsyncioTestCase):
    async def test_uses_places_api_new_and_maps_optional_fields(self):
        response = MagicMock()
        response.json.return_value = {
            "places": [
                {
                    "id": "full-place",
                    "displayName": {"text": "Golden Gate Park"},
                    "formattedAddress": "San Francisco, CA, USA",
                    "location": {"latitude": 37.7694, "longitude": -122.4862},
                    "rating": 4.8,
                },
                {"id": "minimal-place"},
            ]
        }

        message = AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "search_for_places",
                    "args": {"queries": ["parks in San Francisco"]},
                    "id": "search-call",
                    "type": "tool_call",
                }
            ],
        )
        state = {"messages": [message], "search_progress": []}

        with (
            patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": TEST_API_KEY}),
            patch("httpx.post", return_value=response) as post,
            patch("src.search.gmaps", create=True) as legacy_client,
            patch("src.search.copilotkit_emit_state", new_callable=AsyncMock),
        ):
            legacy_client.places.return_value = {"results": []}
            result = await search_node(state, {})

        post.assert_called_once_with(
            "https://places.googleapis.com/v1/places:searchText",
            json={"textQuery": "parks in San Francisco"},
            headers={
                "X-Goog-Api-Key": TEST_API_KEY,
                "X-Goog-FieldMask": (
                    "places.id,places.displayName,places.formattedAddress,"
                    "places.location,places.rating"
                ),
            },
            timeout=10.0,
        )
        response.raise_for_status.assert_called_once_with()
        legacy_client.places.assert_not_called()

        content = result["messages"][-1].content
        places = json.loads(
            content.removeprefix("Added the following search results: ")
        )
        self.assertEqual(
            places,
            [
                {
                    "id": "full-place",
                    "name": "Golden Gate Park",
                    "address": "San Francisco, CA, USA",
                    "latitude": 37.7694,
                    "longitude": -122.4862,
                    "rating": 4.8,
                },
                {
                    "id": "minimal-place",
                    "name": "",
                    "address": "",
                    "latitude": 0,
                    "longitude": 0,
                    "rating": 0,
                },
            ],
        )


if __name__ == "__main__":
    unittest.main()
