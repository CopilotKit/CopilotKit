"""Langroid agent backing the Agentic Chat cell.

Tools:
  - get_weather (backend-executed, rendered by frontend useRenderTool)
  - change_background (frontend-executed via useFrontendTool)
"""

from __future__ import annotations

import json
import os
import random
from typing import Annotated

import langroid as lr
import langroid.language_models as lm
from langroid.agent.tool_message import ToolMessage
from dotenv import load_dotenv

load_dotenv()


# ─── Minimal inline tool implementations ────────────────────────────────

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


def get_weather_impl(city: str) -> dict:
    """Return mock weather data for the given city (seeded by name)."""
    rng = random.Random(city.lower())
    return {
        "city": city,
        "temperature": rng.randint(20, 95),
        "humidity": rng.randint(30, 90),
        "wind_speed": rng.randint(2, 30),
        "feels_like": rng.randint(15, 100),
        "conditions": rng.choice(_CONDITIONS),
    }


# ─── Langroid tool definitions ─────────────────────────────────────────

class GetWeatherTool(ToolMessage):
    request: str = "get_weather"
    purpose: str = "Get current weather for a location."
    location: str

    def handle(self) -> str:
        return json.dumps(get_weather_impl(self.location))


class ChangeBackgroundTool(ToolMessage):
    request: str = "change_background"
    purpose: str = (
        "Change the background color/gradient of the chat area. "
        "ONLY call this when the user explicitly asks."
    )
    background: Annotated[str, "CSS background value. Prefer gradients."]

    def handle(self) -> str:
        return f"Background changed to {self.background}"


BACKEND_TOOLS = [GetWeatherTool]
FRONTEND_TOOLS = [ChangeBackgroundTool]
ALL_TOOLS = BACKEND_TOOLS + FRONTEND_TOOLS
FRONTEND_TOOL_NAMES = {t.default_value("request") for t in FRONTEND_TOOLS}


SYSTEM_PROMPT = (
    "You are a polished, professional demo assistant for CopilotKit. "
    "Keep responses brief and clear — 1 to 2 sentences max.\n\n"
    "You can:\n"
    "- Chat naturally with the user\n"
    "- Change the UI background when asked (via change_background)\n"
    "- Get weather information (via get_weather)\n"
    "When asked about weather, always use the get_weather tool."
)


def create_agent() -> lr.ChatAgent:
    """Create a Langroid ChatAgent for the Agentic Chat cell."""
    model = os.getenv("LANGROID_MODEL", "openai/gpt-4.1")
    llm_config = lm.OpenAIGPTConfig(chat_model=model, stream=True)
    agent_config = lr.ChatAgentConfig(
        llm=llm_config,
        system_message=SYSTEM_PROMPT,
    )
    agent = lr.ChatAgent(agent_config)
    agent.enable_message(ALL_TOOLS)
    return agent
