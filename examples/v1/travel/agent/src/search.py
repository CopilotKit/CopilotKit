"""
The search node is responsible for searching the internet for information.
"""

import json
import os
from typing import cast

import httpx
from copilotkit.langgraph import copilotkit_customize_config, copilotkit_emit_state
from langchain.tools import tool
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.runnables import RunnableConfig

from src.state import AgentState


@tool
def search_for_places(queries: list[str]) -> list[dict]:
    """Search for places based on a query, returns a list of places including their name, address, and coordinates."""


PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
PLACES_FIELD_MASK = (
    "places.id,places.displayName,places.formattedAddress,places.location,places.rating"
)


async def _search_places(
    client: httpx.AsyncClient, query: str, query_index: int
) -> list[dict]:
    """Search Places API (New) and map its response to the shared Place shape."""
    response = await client.post(
        PLACES_SEARCH_URL,
        json={"textQuery": query},
        headers={
            "X-Goog-Api-Key": os.environ["GOOGLE_MAPS_API_KEY"],
            "X-Goog-FieldMask": PLACES_FIELD_MASK,
        },
        timeout=10.0,
    )
    response.raise_for_status()

    places = []
    for result in response.json().get("places", []):
        display_name = (result.get("displayName") or {}).get("text", "")
        location = result.get("location") or {}
        places.append(
            {
                "id": result.get("id", f"{display_name}-{query_index}"),
                "name": display_name,
                "address": result.get("formattedAddress", ""),
                "latitude": location.get("latitude", 0),
                "longitude": location.get("longitude", 0),
                "rating": result.get("rating", 0),
            }
        )

    return places


async def search_node(state: AgentState, config: RunnableConfig):
    """
    The search node is responsible for searching the for places.
    """
    ai_message = cast(AIMessage, state["messages"][-1])

    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[
            {
                "state_key": "search_progress",
                "tool": "search_for_places",
                "tool_argument": "search_progress",
            }
        ],
    )

    state["search_progress"] = []
    queries = ai_message.tool_calls[0]["args"]["queries"]

    for query in queries:
        state["search_progress"].append({"query": query, "results": [], "done": False})

    await copilotkit_emit_state(config, state)

    places = []
    async with httpx.AsyncClient() as client:
        for i, query in enumerate(queries):
            places.extend(await _search_places(client, query, i))
            state["search_progress"][i]["done"] = True
            await copilotkit_emit_state(config, state)

    state["search_progress"] = []
    await copilotkit_emit_state(config, state)

    state["messages"].append(
        ToolMessage(
            tool_call_id=ai_message.tool_calls[0]["id"],
            content=f"Added the following search results: {json.dumps(places)}",
        )
    )

    return state
