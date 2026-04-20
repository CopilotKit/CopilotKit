"""Claude Agent SDK (Python) backing the Tool Rendering demo.

Single backend tool `get_weather`; frontend renders the WeatherCard.
"""

from __future__ import annotations

import json
import random
from textwrap import dedent
from typing import Any

from ag_ui_runner import make_runner
from pydantic import BaseModel


TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_weather",
        "description": "Get current weather for a location. Frontend renders the card.",
        "input_schema": {
            "type": "object",
            "properties": {"location": {"type": "string"}},
            "required": ["location"],
        },
    },
]


SYSTEM_PROMPT = dedent(
    """
    You are a helpful assistant that answers questions about the weather.
    Call `get_weather` whenever the user asks about weather in a location.
    """
).strip()


class AgentState(BaseModel):
    pass


_CONDITIONS = [
    "Sunny",
    "Partly Cloudy",
    "Cloudy",
    "Overcast",
    "Light Rain",
    "Heavy Rain",
    "Thunderstorm",
    "Snow",
    "Foggy",
    "Windy",
]


def _get_weather(city: str) -> dict[str, Any]:
    rng = random.Random(city.lower())
    temperature = rng.randint(20, 95)
    return {
        "city": city,
        "temperature": temperature,
        "humidity": rng.randint(30, 90),
        "wind_speed": rng.randint(2, 30),
        "feels_like": temperature + rng.randint(-5, 5),
        "conditions": rng.choice(_CONDITIONS),
    }


def execute_tool(name: str, tool_input: dict[str, Any], state: AgentState) -> tuple[str, AgentState | None]:
    if name == "get_weather":
        return json.dumps(_get_weather(tool_input["location"])), None
    return f"Unknown tool: {name}", None


run_agent = make_runner(
    tools=TOOLS,
    system_prompt=SYSTEM_PROMPT,
    state_cls=AgentState,
    execute_tool=execute_tool,
)
