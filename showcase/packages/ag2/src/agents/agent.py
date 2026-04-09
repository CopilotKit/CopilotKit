"""
AG2 agent with weather tool for CopilotKit showcase.

Uses AG2's ConversableAgent with AGUIStream to expose
the agent via the AG-UI protocol.
"""

from __future__ import annotations

from typing import Annotated

import httpx
from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from dotenv import load_dotenv

load_dotenv()


# =====
# Tools
# =====
async def get_weather(
    location: Annotated[str, "City name to get weather for"],
) -> dict[str, str | float]:
    """Get current weather for a location using the Open-Meteo API."""
    async with httpx.AsyncClient() as client:
        geocoding_url = (
            f"https://geocoding-api.open-meteo.com/v1/search"
            f"?name={location}&count=1"
        )
        geo = (await client.get(geocoding_url)).json()

        if not geo.get("results"):
            return {"error": f"Location '{location}' not found"}

        result = geo["results"][0]
        lat, lon, name = result["latitude"], result["longitude"], result["name"]

        weather_url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,apparent_temperature,"
            f"relative_humidity_2m,wind_speed_10m,weather_code"
        )
        current = (await client.get(weather_url)).json()["current"]

        # Map WMO weather codes to human-readable conditions
        code = current["weather_code"]
        conditions = _wmo_code_to_text(code)

        return {
            "city": name,
            "temperature": current["temperature_2m"],
            "feels_like": current["apparent_temperature"],
            "humidity": current["relative_humidity_2m"],
            "wind_speed": current["wind_speed_10m"],
            "conditions": conditions,
        }


def _wmo_code_to_text(code: int) -> str:
    """Convert WMO weather code to human-readable text."""
    mapping = {
        0: "Clear sky",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Foggy",
        48: "Depositing rime fog",
        51: "Light drizzle",
        53: "Moderate drizzle",
        55: "Dense drizzle",
        61: "Slight rain",
        63: "Moderate rain",
        65: "Heavy rain",
        71: "Slight snow",
        73: "Moderate snow",
        75: "Heavy snow",
        80: "Slight rain showers",
        81: "Moderate rain showers",
        82: "Violent rain showers",
        85: "Slight snow showers",
        86: "Heavy snow showers",
        95: "Thunderstorm",
        96: "Thunderstorm with slight hail",
        99: "Thunderstorm with heavy hail",
    }
    return mapping.get(code, f"Unknown ({code})")


# =====
# Agent
# =====
agent = ConversableAgent(
    name="assistant",
    system_message=(
        "You are a helpful assistant. You can look up current weather "
        "for any city using the get_weather tool. When asked about the "
        "weather, always use the tool rather than guessing. Be concise "
        "and friendly in your responses."
    ),
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    functions=[get_weather],
)

# AG-UI stream wrapper
stream = AGUIStream(agent)
