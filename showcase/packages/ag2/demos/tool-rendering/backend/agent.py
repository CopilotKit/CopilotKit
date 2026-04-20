"""AG2 agent backing the Tool Rendering demo.

The agent exposes a single backend tool (get_weather) whose tool-call
and result are rendered as a rich WeatherCard by the frontend via
useRenderTool.
"""

from __future__ import annotations

import random
from typing import Annotated

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from dotenv import load_dotenv

load_dotenv()


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


async def get_weather(
    location: Annotated[str, "City name to get weather for"],
) -> dict[str, str | float]:
    """Get current weather for a location."""
    rng = random.Random(location.lower())
    temperature = rng.randint(20, 95)
    humidity = rng.randint(30, 90)
    wind_speed = rng.randint(2, 30)
    feels_like = temperature + rng.randint(-5, 5)
    conditions = rng.choice(_CONDITIONS)
    return {
        "city": location,
        "temperature": temperature,
        "humidity": humidity,
        "wind_speed": wind_speed,
        "feels_like": feels_like,
        "conditions": conditions,
    }


agent = ConversableAgent(
    name="assistant",
    system_message=(
        "You are a weather assistant. When the user asks about weather "
        "in a city, always use the get_weather tool. Be concise."
    ),
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    functions=[get_weather],
)

stream = AGUIStream(agent)
