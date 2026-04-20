"""PydanticAI agent for the Agentic Chat cell.

Minimal conversational agent with a get_weather tool (rendered by the
frontend as a weather card). Frontend may inject additional tools at
runtime (e.g. change_background via useFrontendTool).
"""

from __future__ import annotations

import json
import random
from textwrap import dedent
from typing import Any

from dotenv import load_dotenv
from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel

load_dotenv()


class State(BaseModel):
    """Placeholder shared state (agentic-chat has no structured state)."""


# Inlined from shared/python/tools/get_weather.py
_CONDITIONS = [
    "Sunny", "Partly Cloudy", "Cloudy", "Overcast",
    "Light Rain", "Heavy Rain", "Thunderstorm", "Snow",
    "Foggy", "Windy",
]


def _get_weather(city: str) -> dict[str, Any]:
    rng = random.Random(city.lower())
    temperature = rng.randint(20, 95)
    humidity = rng.randint(30, 90)
    wind_speed = rng.randint(2, 30)
    feels_like = temperature + rng.randint(-5, 5)
    conditions = rng.choice(_CONDITIONS)
    return {
        "city": city,
        "temperature": temperature,
        "humidity": humidity,
        "wind_speed": wind_speed,
        "feels_like": feels_like,
        "conditions": conditions,
    }


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1-mini"),
    deps_type=StateDeps[State],
    system_prompt=dedent("""
        You are a helpful, friendly assistant. Keep responses concise.
        You have a get_weather tool for weather questions.
    """).strip(),
)


@agent.tool
def get_weather(ctx: RunContext[StateDeps[State]], location: str) -> str:
    """Get the weather for a given location. Ensure location is fully spelled out."""
    return json.dumps(_get_weather(location))
