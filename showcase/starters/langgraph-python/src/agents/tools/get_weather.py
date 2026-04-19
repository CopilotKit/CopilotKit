"""Mock weather data tool implementation."""

import random
from src.agents.types import WeatherResult

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

def get_weather_impl(city: str) -> WeatherResult:
    """Return mock weather data for the given city.

    Uses a seeded random based on the city name so repeated calls
    for the same city return consistent results within a session.
    """
    rng = random.Random(city.lower())
    temperature = rng.randint(20, 95)
    humidity = rng.randint(30, 90)
    wind_speed = rng.randint(2, 30)
    feels_like = temperature + rng.randint(-5, 5)
    conditions = rng.choice(_CONDITIONS)

    return WeatherResult(
        city=city,
        temperature=temperature,
        humidity=humidity,
        wind_speed=wind_speed,
        feels_like=feels_like,
        conditions=conditions,
    )
