"""Strands agent backing the Agentic Chat cell.

Natural conversation + weather lookup. Frontend tools (change_background)
are registered on the client via useFrontendTool and invoked by the agent
through the AG-UI protocol.
"""

import json
import os
import random

from ag_ui_strands import StrandsAgent
from dotenv import load_dotenv
from strands import Agent, tool
from strands.models.openai import OpenAIModel

load_dotenv()


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


@tool
def get_weather(location: str):
    """Get current weather for a location.

    Args:
        location: The location to get weather for

    Returns:
        Weather information as JSON string
    """
    return json.dumps(_get_weather_impl(location))


@tool
def change_background(background: str):
    """Change the background color of the chat UI.

    This is a frontend tool - it returns None as the actual
    execution happens on the frontend via useFrontendTool.

    Args:
        background: The CSS background to set (color, gradient, etc.)
    """
    return None


api_key = os.getenv("OPENAI_API_KEY", "")
model = OpenAIModel(
    client_args={"api_key": api_key},
    model_id="gpt-4o-mini",
)

system_prompt = (
    "You are a helpful, concise assistant. "
    "Keep responses brief - 1 to 2 sentences max. "
    "You can change the UI background (via change_background frontend tool) "
    "and look up weather (via get_weather tool)."
)

strands_agent = Agent(
    model=model,
    system_prompt=system_prompt,
    tools=[get_weather, change_background],
)

agui_agent = StrandsAgent(
    agent=strands_agent,
    name="agentic_chat",
    description="Natural conversation assistant with weather and UI tools",
)
