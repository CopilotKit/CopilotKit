"""AG2 agent backing the Agentic Chat demo.

Uses AG2's ConversableAgent with AGUIStream to expose the agent via
the AG-UI protocol. Provides a single backend tool (get_weather) so
the frontend can demonstrate tool-call rendering. The change_background
tool is registered by the frontend via useFrontendTool.
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
    """Get current weather for a location. Seeded per city for repeatability."""
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
        "You are a helpful, concise assistant. You can look up current "
        "weather for any city using the get_weather tool, and you can "
        "change the chat background by calling change_background (a "
        "frontend-registered tool). When asked about the weather, always "
        "use the tool rather than guessing."
    ),
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    functions=[get_weather],
)

stream = AGUIStream(agent)
