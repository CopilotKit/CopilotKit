"""PydanticAI agent for the Sub-Agents cell.

A supervisor agent delegates flights/hotels/experiences lookups to
sub-agents. This minimal version models all four as tools and lets the
supervisor decide which to call.
"""

from __future__ import annotations

import json
from textwrap import dedent
from typing import Any

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel

load_dotenv()


class State(BaseModel):
    itinerary: list[dict[str, Any]] = Field(default_factory=list)


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1-mini"),
    deps_type=StateDeps[State],
    system_prompt=dedent("""
        You are a travel planning supervisor. Use the flight_search,
        hotel_search, and experience_search tools to assemble an
        itinerary. Keep answers short.
    """).strip(),
)


@agent.tool
def flight_search(
    ctx: RunContext[StateDeps[State]],
    origin: str,
    destination: str,
) -> str:
    """Find flights between two cities. Returns a short mock list."""
    return json.dumps({
        "flights": [
            {
                "airline": "Demo Air",
                "flightNumber": "DA100",
                "origin": origin,
                "destination": destination,
                "price": "$299",
            }
        ]
    })


@agent.tool
def hotel_search(ctx: RunContext[StateDeps[State]], city: str) -> str:
    """Find hotels in a city. Returns a short mock list."""
    return json.dumps({
        "hotels": [
            {"name": "Demo Plaza", "city": city, "pricePerNight": "$180"}
        ]
    })


@agent.tool
def experience_search(ctx: RunContext[StateDeps[State]], city: str) -> str:
    """Find experiences in a city. Returns a short mock list."""
    return json.dumps({
        "experiences": [
            {"title": f"Walking tour of {city}", "duration": "3h"}
        ]
    })
