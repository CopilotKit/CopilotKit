import asyncio
import os
from pathlib import Path
from typing import TypedDict

from copilotkit import CopilotKitMiddleware
from copilotkit.langgraph import copilotkit_emit_state
from dotenv import load_dotenv
from langchain.agents import AgentState as BaseAgentState, create_agent
from langchain.messages import ToolMessage
from langchain.tools import ToolRuntime, tool
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

load_dotenv(Path(__file__).with_name(".env"))

DEFAULT_CENTER = [37.7749, -122.4194]


class Attraction(TypedDict):
    id: str
    name: str
    latitude: float
    longitude: float
    description: str


class TravelState(BaseAgentState):
    status: str
    search_area: str
    center: list[float]
    attractions: list[Attraction]


async def update_state(runtime: ToolRuntime, message: str, **changes) -> Command:
    """Stream a complete state snapshot, then persist the changed fields."""
    snapshot = {
        "status": runtime.state.get("status", "Working"),
        "search_area": runtime.state.get("search_area", ""),
        "center": runtime.state.get("center", DEFAULT_CENTER),
        "attractions": runtime.state.get("attractions", []),
        **changes,
    }
    await copilotkit_emit_state(runtime.config, snapshot)

    return Command(
        update={
            **changes,
            "messages": [
                ToolMessage(content=message, tool_call_id=runtime.tool_call_id)
            ],
        }
    )


@tool
async def plan_trip(
    search_area: str,
    center_latitude: float,
    center_longitude: float,
    runtime: ToolRuntime,
) -> Command:
    """Choose the travel search area and its approximate map center."""
    await asyncio.sleep(0.7)
    return await update_state(
        runtime,
        f"Searching {search_area}",
        status=f"Scouting {search_area}",
        search_area=search_area,
        center=[center_latitude, center_longitude],
        attractions=[],
    )


@tool
async def add_attraction(
    name: str,
    latitude: float,
    longitude: float,
    description: str,
    runtime: ToolRuntime,
) -> Command:
    """Add one attraction with approximate coordinates to the shared map state."""
    await asyncio.sleep(0.7)
    attractions = list(runtime.state.get("attractions", []))
    attractions.append(
        {
            "id": f"attraction-{len(attractions) + 1}",
            "name": name,
            "latitude": latitude,
            "longitude": longitude,
            "description": description,
        }
    )

    return await update_state(
        runtime,
        f"Added {name}",
        status=f"Adding attraction {len(attractions)}: {name}",
        attractions=attractions,
    )


@tool(return_direct=True)
async def finish_trip(runtime: ToolRuntime) -> Command:
    """Finish the workflow after all requested attractions are on the map."""
    await asyncio.sleep(0.7)
    count = len(runtime.state.get("attractions", []))
    return await update_state(
        runtime,
        f"Finished with {count} attractions",
        status=f"Found {count} attractions",
    )


model = ChatOpenAI(
    model=os.getenv("OPENAI_MODEL", "gpt-5.5"),
    model_kwargs={"parallel_tool_calls": False},
)

graph = create_agent(
    model=model,
    tools=[plan_trip, add_attraction, finish_trip],
    middleware=[CopilotKitMiddleware()],
    state_schema=TravelState,
    checkpointer=MemorySaver(),
    system_prompt=(
        "You are a travel scout. Use your geographic knowledge to map the "
        "attractions requested by the user. Coordinates may be approximate. "
        "First call plan_trip exactly once. Then call add_attraction once per "
        "attraction, one at a time, with a concise description. Finally call "
        "finish_trip exactly once. Default to five attractions when no count "
        "is given. Never reorder, skip, or parallelize these steps."
    ),
)
