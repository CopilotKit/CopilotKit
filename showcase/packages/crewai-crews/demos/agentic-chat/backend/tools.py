"""Tools for the Agentic Chat crew (copied from showcase shared_python)."""

import json
import random
from typing import Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field


_CONDITIONS = [
    "Sunny", "Partly Cloudy", "Cloudy", "Overcast", "Light Rain",
    "Heavy Rain", "Thunderstorm", "Snow", "Foggy", "Windy",
]


def _get_weather_impl(city: str) -> dict:
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


class GetWeatherInput(BaseModel):
    location: str = Field(..., description="The location to get weather for.")


class GetWeatherTool(BaseTool):
    name: str = "get_weather"
    description: str = "Get current weather for a location. Ensure location is fully spelled out."
    args_schema: Type[BaseModel] = GetWeatherInput

    def _run(self, location: str) -> str:
        return json.dumps(_get_weather_impl(location))
